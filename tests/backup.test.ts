import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { createBackupScheduler, isAutomaticBackupDue } from '../src/main/backup-scheduler'
import {
  BackupServiceError,
  createBackupService,
  isSameWindowsVolume
} from '../src/main/backup-service'

const migrationNames = [
  '001_initial_schema.sql',
  '002_multiple_tax_rates.sql',
  '003_tenders_and_price_overrides.sql',
  '004_credit_tender_type.sql',
  '005_business_email.sql',
  '006_receipt_business_details.sql',
  '007_standalone_returns.sql',
  '008_transaction_numbers.sql',
  '009_sale_charges.sql',
  '010_charge_payment_tenders.sql',
  '011_customers.sql',
  '012_transaction_customers.sql'
]

function createSchema(path: string, version = 12): Database.Database {
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  const migrationCount = version === 11 ? 11 : migrationNames.length
  for (const name of migrationNames.slice(0, migrationCount)) {
    database.exec(readFileSync(join(process.cwd(), 'src/main/database/migrations', name), 'utf8'))
  }
  database.pragma(`user_version = ${version}`)
  database.pragma('journal_mode = WAL')
  return database
}

function createService(
  database: Database.Database,
  databasePath: string,
  userDataPath: string,
  now: () => Date = () => new Date('2026-10-28T10:00:00.000Z')
) {
  return createBackupService({
    database,
    databasePath,
    userDataPath,
    supportedSchemaVersion: 12,
    now,
    sameVolume: () => false,
    openStagedDatabase(path) {
      const staged = new Database(path)
      staged.pragma('foreign_keys = ON')
      if ((staged.pragma('user_version', { simple: true }) as number) === 11) {
        staged.exec(
          readFileSync(
            join(process.cwd(), 'src/main/database/migrations/012_transaction_customers.sql'),
            'utf8'
          )
        )
        staged.pragma('user_version = 12')
      }
      return staged
    }
  })
}

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'pos-backup-test-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('creates a consistent full database snapshot from a WAL database', async () => {
  await withDirectory(async (directory) => {
    const databasePath = join(directory, 'pos-system.sqlite')
    const backupFolder = join(directory, 'external-drive')
    const userDataPath = join(directory, 'user-data')
    await mkdir(backupFolder)
    const database = createSchema(databasePath)
    try {
      database
        .prepare(
          "UPDATE settings SET business_name = 'Harbour Market', business_email = 'hello@example.com'"
        )
        .run()
      database
        .prepare(
          "INSERT INTO tax_rates (name, rate_basis_points, sort_order) VALUES ('GST', 500, 0)"
        )
        .run()
      const customerId = Number(
        database
          .prepare(
            `INSERT INTO customers (first_name, last_name, company_name, image_data_url)
             VALUES ('Alex', 'Lee', 'Harbour Market', 'data:image/png;base64,abc')`
          )
          .run().lastInsertRowid
      )
      const productId = Number(
        database
          .prepare("INSERT INTO products (sku, name, price_cents) VALUES ('P1', 'Portrait', 2500)")
          .run().lastInsertRowid
      )
      const saleId = Number(
        database
          .prepare(
            `INSERT INTO sales (
               subtotal_cents, tax_cents, total_cents, payment_method, transaction_number, customer_id
             ) VALUES (2500, 125, 2625, 'card', 'S-1', ?)`
          )
          .run(customerId).lastInsertRowid
      )
      database
        .prepare(
          `INSERT INTO sale_items (
             sale_id, product_id, sku, product_name, unit_price_cents, original_unit_price_cents,
             quantity, line_total_cents
           ) VALUES (?, ?, 'P1', 'Portrait', 2500, 2500, 1, 2500)`
        )
        .run(saleId, productId)
      database
        .prepare(
          'INSERT INTO sale_payments (sale_id, payment_type, amount_applied_cents, change_cents) VALUES (?, ?, ?, 0)'
        )
        .run(saleId, 'credit', 2625)
      database
        .prepare(
          'INSERT INTO sale_taxes (sale_id, tax_name, rate_basis_points, tax_cents) VALUES (?, ?, ?, ?)'
        )
        .run(saleId, 'GST', 500, 125)
      const chargeId = Number(
        database
          .prepare(
            `INSERT INTO sale_charges (sale_id, customer_name, company_name, amount_cents)
             VALUES (?, 'Alex Lee', 'Harbour Market', 1000)`
          )
          .run(saleId).lastInsertRowid
      )
      database
        .prepare(
          'INSERT INTO charge_payments (charge_id, payment_type, amount_cents) VALUES (?, ?, ?)'
        )
        .run(chargeId, 'check', 250)
      database
        .prepare(
          `INSERT INTO sales (
             subtotal_cents, tax_cents, total_cents, payment_method, transaction_type,
             transaction_number, return_reason, customer_id
           ) VALUES (1000, 50, 1050, 'cash', 'return', 'R-1', 'Damaged', ?)`
        )
        .run(customerId)

      const service = createService(database, databasePath, userDataPath)
      await service.setDestination(backupFolder)
      const status = await service.runManual()
      assert.equal(status.lastAttemptStatus, 'success')
      assert.equal(status.lastBackupKind, 'manual')
      assert.deepEqual(createService(database, databasePath, userDataPath).getStatus(), status)
      const files = await readdir(backupFolder)
      assert.equal(files.length, 1)

      const snapshot = new Database(join(backupFolder, files[0]), { readonly: true })
      try {
        assert.equal(snapshot.pragma('journal_mode', { simple: true }), 'delete')
        assert.equal(snapshot.prepare('SELECT count(*) AS count FROM sales').get().count, 2)
        assert.equal(snapshot.prepare('SELECT count(*) AS count FROM sale_items').get().count, 1)
        assert.equal(snapshot.prepare('SELECT count(*) AS count FROM sale_payments').get().count, 1)
        assert.equal(snapshot.prepare('SELECT count(*) AS count FROM sale_taxes').get().count, 1)
        assert.equal(
          snapshot.prepare('SELECT count(*) AS count FROM charge_payments').get().count,
          1
        )
        assert.equal(
          snapshot.prepare('SELECT image_data_url FROM customers WHERE id = ?').get(customerId)
            .image_data_url,
          'data:image/png;base64,abc'
        )
        assert.equal(
          snapshot.prepare('SELECT business_name FROM settings').get().business_name,
          'Harbour Market'
        )
        assert.equal(snapshot.prepare('SELECT count(*) AS count FROM tax_rates').get().count, 1)
        assert.equal(snapshot.pragma('foreign_key_check').length, 0)
      } finally {
        snapshot.close()
      }
    } finally {
      database.close()
    }
  })
})

test('retains automatic backups for 90 days and never prunes manual backups', async () => {
  await withDirectory(async (directory) => {
    const databasePath = join(directory, 'pos-system.sqlite')
    const backupFolder = join(directory, 'external-drive')
    const database = createSchema(databasePath)
    await mkdir(backupFolder)
    const oldAutomatic = join(backupFolder, 'POS-Backup-automatic-old.sqlite')
    const oldManual = join(backupFolder, 'POS-Backup-manual-old.sqlite')
    const recentAutomatic = join(backupFolder, 'POS-Backup-automatic-recent.sqlite')
    await Promise.all(
      [oldAutomatic, oldManual, recentAutomatic].map((path) => writeFile(path, 'old'))
    )
    const now = new Date('2026-10-28T10:00:00.000Z')
    const oldTime = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000)
    const recentTime = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    await utimes(oldAutomatic, oldTime, oldTime)
    await utimes(oldManual, oldTime, oldTime)
    await utimes(recentAutomatic, recentTime, recentTime)
    try {
      const service = createService(database, databasePath, join(directory, 'user-data'), () => now)
      await service.setDestination(backupFolder)
      await service.runAutomatic()
      const files = await readdir(backupFolder)
      assert.equal(files.includes('POS-Backup-automatic-old.sqlite'), false)
      assert.equal(files.includes('POS-Backup-manual-old.sqlite'), true)
      assert.equal(files.includes('POS-Backup-automatic-recent.sqlite'), true)
    } finally {
      database.close()
    }
  })
})

test('restores a complete snapshot over existing data and makes a safety copy first', async () => {
  await withDirectory(async (directory) => {
    const databasePath = join(directory, 'pos-system.sqlite')
    const backupFolder = join(directory, 'external-drive')
    const userDataPath = join(directory, 'user-data')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(backupFolder))
    const database = createSchema(databasePath)
    database.prepare("UPDATE settings SET business_name = 'Original Store'").run()
    database
      .prepare("INSERT INTO customers (first_name, image_data_url) VALUES ('Alex', 'img')")
      .run()
    const service = createService(database, databasePath, userDataPath)
    await service.setDestination(backupFolder)
    const backup = await service.runManual()
    const backupPath = join(backupFolder, (await readdir(backupFolder))[0])
    database.prepare("UPDATE settings SET business_name = 'Changed Store'").run()
    database.prepare('DELETE FROM customers').run()

    const restore = await service.restore(backupPath)
    assert.equal((await stat(restore.safetyCopyPath)).isFile(), true)
    assert.equal(database.open, false)
    const restoredDatabase = new Database(databasePath, { readonly: true })
    try {
      assert.equal(
        restoredDatabase.prepare('SELECT business_name FROM settings').get().business_name,
        'Original Store'
      )
      assert.equal(
        restoredDatabase.prepare('SELECT image_data_url FROM customers').get().image_data_url,
        'img'
      )
      assert.equal(restoredDatabase.pragma('user_version', { simple: true }), 12)
    } finally {
      restoredDatabase.close()
    }

    const safetyCopy = new Database(restore.safetyCopyPath, { readonly: true })
    try {
      assert.equal(
        safetyCopy.prepare('SELECT business_name FROM settings').get().business_name,
        'Changed Store'
      )
      assert.equal(safetyCopy.prepare('SELECT count(*) AS count FROM customers').get().count, 0)
    } finally {
      safetyCopy.close()
    }
    assert.equal(backup.lastBackupKind, 'manual')
  })
})

test('upgrades older supported backups and rejects corrupt or newer files without closing the live database', async () => {
  await withDirectory(async (directory) => {
    const databasePath = join(directory, 'pos-system.sqlite')
    const currentDatabase = createSchema(databasePath)
    const olderPath = join(directory, 'old.sqlite')
    const olderDatabase = createSchema(olderPath, 11)
    olderDatabase
      .prepare(
        `INSERT INTO sales (
           subtotal_cents, tax_cents, total_cents, payment_method, transaction_number
         ) VALUES (1000, 50, 1050, 'cash', 'OLD-1')`
      )
      .run()
    const corruptPath = join(directory, 'corrupt.sqlite')
    const newerPath = join(directory, 'newer.sqlite')
    const newerDatabase = createSchema(newerPath, 13)
    const service = createService(currentDatabase, databasePath, join(directory, 'user-data'))
    try {
      await assert.rejects(service.restore(databasePath), (error: unknown) => {
        assert.ok(error instanceof BackupServiceError)
        assert.equal(error.code, 'invalid-backup')
        return true
      })
      await writeFile(corruptPath, 'not a sqlite database')
      await assert.rejects(service.restore(corruptPath), (error: unknown) => {
        assert.ok(error instanceof BackupServiceError)
        assert.equal(error.code, 'invalid-backup')
        return true
      })
      await assert.rejects(service.restore(newerPath), (error: unknown) => {
        assert.ok(error instanceof BackupServiceError)
        assert.equal(error.code, 'unsupported-version')
        return true
      })
      assert.equal(currentDatabase.open, true)

      const oldBackup = join(directory, 'old-backup.sqlite')
      await olderDatabase.backup(oldBackup)
      const result = await service.restore(oldBackup)
      assert.equal(result.safetyCopyPath.endsWith('POS-Safety-Before-Restore.sqlite'), true)
      const restored = new Database(databasePath, { readonly: true })
      try {
        assert.equal(restored.pragma('user_version', { simple: true }), 12)
        assert.equal(restored.prepare('SELECT customer_id FROM sales').get().customer_id, null)
      } finally {
        restored.close()
      }
    } finally {
      if (olderDatabase.open) olderDatabase.close()
      if (newerDatabase.open) newerDatabase.close()
      if (currentDatabase.open) currentDatabase.close()
    }
  })
})

test('checks automatic catch-up timing and retries a failed scheduled backup after 15 minutes', async () => {
  const morning = new Date(2026, 9, 28, 1, 59)
  const dueTime = new Date(2026, 9, 28, 2, 0)
  const yesterday = '2026-10-27'
  const today = '2026-10-28'
  assert.equal(isAutomaticBackupDue(morning, yesterday), false)
  assert.equal(isAutomaticBackupDue(dueTime, yesterday), true)
  assert.equal(isAutomaticBackupDue(new Date(2026, 9, 28, 3), today), false)

  let currentTime = new Date(2026, 9, 28, 3)
  let automaticDate: string | null = null
  let attempts = 0
  const scheduler = createBackupScheduler(
    {
      getStatus: () => ({ destinationPath: 'D:\\POS Backups' }),
      getLastAutomaticDate: () => automaticDate,
      async runAutomatic() {
        attempts += 1
        if (attempts === 1) throw new Error('drive disconnected')
        automaticDate = today
      }
    },
    { now: () => currentTime }
  )
  await scheduler.checkNow()
  await scheduler.checkNow()
  assert.equal(attempts, 1)
  currentTime = new Date(currentTime.getTime() + 15 * 60 * 1000)
  await scheduler.checkNow()
  assert.equal(attempts, 2)
  await scheduler.checkNow()
  assert.equal(attempts, 2)
})

test('recognizes same and different Windows drives, including network shares', () => {
  assert.equal(isSameWindowsVolume('C:\\Users\\POS\\pos.sqlite', 'c:\\Backups'), true)
  assert.equal(isSameWindowsVolume('C:\\Users\\POS\\pos.sqlite', 'D:\\Backups'), false)
  assert.equal(
    isSameWindowsVolume('\\\\server\\share\\POS\\pos.sqlite', '\\\\SERVER\\SHARE\\Backups'),
    true
  )
  assert.equal(
    isSameWindowsVolume('\\\\server\\share\\POS\\pos.sqlite', '\\\\other\\share\\Backups'),
    false
  )
})

test('rejects a backup folder on the database drive and reports unavailable folders', async () => {
  await withDirectory(async (directory) => {
    const databasePath = join(directory, 'pos-system.sqlite')
    const database = createSchema(databasePath)
    const userDataPath = join(directory, 'user-data')
    const sameDriveService = createBackupService({
      database,
      databasePath,
      userDataPath,
      supportedSchemaVersion: 12,
      sameVolume: () => true,
      openStagedDatabase(path) {
        return new Database(path)
      }
    })
    try {
      await assert.rejects(sameDriveService.setDestination(directory), (error: unknown) => {
        assert.ok(error instanceof BackupServiceError)
        assert.equal(error.code, 'same-drive')
        return true
      })

      const differentDriveService = createService(database, databasePath, userDataPath)
      await assert.rejects(
        differentDriveService.setDestination(join(directory, 'missing-drive')),
        (error: unknown) => {
          assert.ok(error instanceof BackupServiceError)
          assert.equal(error.code, 'unavailable')
          return true
        }
      )
      assert.equal(differentDriveService.getStatus().destinationPath, null)
      assert.equal(database.open, true)
    } finally {
      database.close()
    }
  })
})

test('records a failed attempt when the configured drive disconnects', async () => {
  await withDirectory(async (directory) => {
    const databasePath = join(directory, 'pos-system.sqlite')
    const backupFolder = join(directory, 'external-drive')
    const database = createSchema(databasePath)
    await mkdir(backupFolder)
    try {
      const service = createService(database, databasePath, join(directory, 'user-data'))
      await service.setDestination(backupFolder)
      await rm(backupFolder, { recursive: true })
      await assert.rejects(service.runManual(), (error: unknown) => {
        assert.ok(error instanceof BackupServiceError)
        assert.equal(error.code, 'unavailable')
        return true
      })
      assert.equal(service.getStatus().lastAttemptStatus, 'failed')
      assert.ok(service.getStatus().lastAttemptError)
    } finally {
      database.close()
    }
  })
})
