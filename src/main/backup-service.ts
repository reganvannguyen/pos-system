import { randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, win32 } from 'node:path'
import Database from 'better-sqlite3'
import type { BackupKind, BackupStatus } from '../shared/pos-api'
import type { PosDatabase } from './database/types'

const automaticPrefix = 'POS-Backup-automatic-'
const manualPrefix = 'POS-Backup-manual-'

interface BackupConfig {
  destinationPath: string | null
  lastBackupAt: string | null
  lastBackupKind: BackupKind | null
  lastAttemptAt: string | null
  lastAttemptStatus: 'success' | 'failed' | null
  lastAttemptError: string | null
  lastAutomaticDate: string | null
}

const emptyConfig: BackupConfig = {
  destinationPath: null,
  lastBackupAt: null,
  lastBackupKind: null,
  lastAttemptAt: null,
  lastAttemptStatus: null,
  lastAttemptError: null,
  lastAutomaticDate: null
}

export type BackupErrorCode =
  | 'not-configured'
  | 'same-drive'
  | 'unavailable'
  | 'invalid-backup'
  | 'unsupported-version'
  | 'restore-failed'

export class BackupServiceError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
    readonly databaseClosed = false
  ) {
    super(message)
    this.name = 'BackupServiceError'
  }
}

export interface BackupServiceOptions {
  database: PosDatabase
  databasePath: string
  userDataPath: string
  supportedSchemaVersion: number
  openStagedDatabase: (databasePath: string) => PosDatabase
  now?: () => Date
  sameVolume?: (databasePath: string, destinationPath: string) => boolean
}

export function createBackupService(options: BackupServiceOptions) {
  const { database, databasePath, userDataPath, supportedSchemaVersion } = options
  const sameVolume = options.sameVolume ?? isSameVolumeForCurrentPlatform
  const configPath = join(userDataPath, 'backup-settings.json')
  const config = readConfig(configPath)
  let backupInProgress = false

  function getStatus(): BackupStatus {
    return {
      destinationPath: config.destinationPath,
      destinationOnSameDrive: config.destinationPath
        ? sameVolume(databasePath, config.destinationPath)
        : false,
      lastBackupAt: config.lastBackupAt,
      lastBackupKind: config.lastBackupKind,
      lastAttemptAt: config.lastAttemptAt,
      lastAttemptStatus: config.lastAttemptStatus,
      lastAttemptError: config.lastAttemptError
    }
  }

  function getLastAutomaticDate(): string | null {
    return config.lastAutomaticDate
  }

  async function setDestination(
    destinationPath: string,
    allowSameDrive = false
  ): Promise<BackupStatus> {
    if (!destinationPath.trim()) {
      throw new BackupServiceError('unavailable', 'Choose a backup folder.')
    }
    if (!allowSameDrive) assertDifferentVolume(databasePath, destinationPath, sameVolume)
    try {
      const info = await stat(destinationPath)
      if (!info.isDirectory()) throw new Error('The selected path is not a folder.')
      await access(destinationPath)
    } catch {
      throw new BackupServiceError(
        'unavailable',
        'The selected backup folder is unavailable. Choose a folder on a connected drive.'
      )
    }

    if (config.destinationPath !== destinationPath) config.lastAutomaticDate = null
    config.destinationPath = destinationPath
    saveConfig(configPath, config)
    return getStatus()
  }

  async function runManual(): Promise<BackupStatus> {
    return createBackup('manual')
  }

  async function runAutomatic(): Promise<BackupStatus> {
    return createBackup('automatic')
  }

  async function createBackup(kind: BackupKind): Promise<BackupStatus> {
    if (backupInProgress) {
      throw new BackupServiceError('unavailable', 'A backup is already in progress.')
    }
    backupInProgress = true
    const attemptedAt = currentTime()
    let temporaryPath: string | undefined
    try {
      const destination = config.destinationPath
      if (!destination) {
        throw new BackupServiceError(
          'not-configured',
          'Choose a backup folder in Settings before creating a backup.'
        )
      }
      const destinationInfo = await stat(destination)
      if (!destinationInfo.isDirectory()) throw new Error('The backup destination is not a folder.')

      const stamp = attemptedAt.toISOString().replace(/[:.]/g, '-')
      const prefix = kind === 'automatic' ? automaticPrefix : manualPrefix
      const finalPath = join(destination, `${prefix}${stamp}-${randomUUID()}.sqlite`)
      temporaryPath = `${finalPath}.tmp`
      await writeSnapshot(database, temporaryPath, supportedSchemaVersion)
      await rename(temporaryPath, finalPath)
      temporaryPath = undefined

      config.lastBackupAt = attemptedAt.toISOString()
      config.lastBackupKind = kind
      config.lastAttemptAt = attemptedAt.toISOString()
      config.lastAttemptStatus = 'success'
      config.lastAttemptError = null
      if (kind === 'automatic') {
        config.lastAutomaticDate = localDateKey(attemptedAt)
      }
      saveConfig(configPath, config)
      return getStatus()
    } catch (error) {
      if (temporaryPath) {
        await rm(temporaryPath, { force: true }).catch(() => undefined)
        await rm(`${temporaryPath}-wal`, { force: true }).catch(() => undefined)
        await rm(`${temporaryPath}-shm`, { force: true }).catch(() => undefined)
      }
      config.lastAttemptAt = attemptedAt.toISOString()
      config.lastAttemptStatus = 'failed'
      config.lastAttemptError =
        error instanceof BackupServiceError
          ? error.message
          : 'The backup could not be saved. Check that the destination drive is connected and writable.'
      saveConfig(configPath, config)
      if (error instanceof BackupServiceError) throw error
      throw new BackupServiceError(
        'unavailable',
        'The backup could not be saved. Check that the destination drive is connected and writable.'
      )
    } finally {
      backupInProgress = false
    }
  }

  async function restore(sourcePath: string): Promise<{ safetyCopyPath: string }> {
    if (backupInProgress) {
      throw new BackupServiceError('restore-failed', 'Wait for the current backup to finish.')
    }
    backupInProgress = true
    let stagedPath: string | undefined
    let displacedPath: string | undefined
    let databaseClosed = false
    try {
      const source = resolve(sourcePath)
      if (isSameWindowsPath(source, databasePath)) {
        throw new BackupServiceError(
          'invalid-backup',
          'Select a backup file, not the active database.'
        )
      }
      validateBackupFile(source, supportedSchemaVersion)

      stagedPath = `${databasePath}.restore-${randomUUID()}`
      await copyFile(source, stagedPath)
      const stagedDatabase = options.openStagedDatabase(stagedPath)
      try {
        validateBackupDatabase(stagedDatabase, supportedSchemaVersion)
      } finally {
        stagedDatabase.close()
      }
      await rm(`${stagedPath}-wal`, { force: true })
      await rm(`${stagedPath}-shm`, { force: true })

      const safetyDirectory = join(userDataPath, 'backups')
      await mkdir(safetyDirectory, { recursive: true })
      const safetyCopyPath = join(safetyDirectory, 'POS-Safety-Before-Restore.sqlite')
      const temporarySafetyCopyPath = `${safetyCopyPath}.${randomUUID()}.tmp`
      try {
        await writeSnapshot(database, temporarySafetyCopyPath, supportedSchemaVersion)
        await rename(temporarySafetyCopyPath, safetyCopyPath)
      } finally {
        await rm(temporarySafetyCopyPath, { force: true }).catch(() => undefined)
        await rm(`${temporarySafetyCopyPath}-wal`, { force: true }).catch(() => undefined)
        await rm(`${temporarySafetyCopyPath}-shm`, { force: true }).catch(() => undefined)
      }

      database.close()
      databaseClosed = true
      await rm(`${databasePath}-wal`, { force: true })
      await rm(`${databasePath}-shm`, { force: true })

      displacedPath = `${databasePath}.before-restore-${randomUUID()}`
      await rename(databasePath, displacedPath)
      try {
        await rename(stagedPath, databasePath)
        stagedPath = undefined
      } catch (error) {
        await rename(displacedPath, databasePath)
        displacedPath = undefined
        throw error
      }
      await rm(displacedPath, { force: true }).catch(() => undefined)
      await rm(`${displacedPath}-wal`, { force: true }).catch(() => undefined)
      await rm(`${displacedPath}-shm`, { force: true }).catch(() => undefined)
      displacedPath = undefined
      return { safetyCopyPath }
    } catch (error) {
      if (stagedPath) await rm(stagedPath, { force: true }).catch(() => undefined)
      if (displacedPath) {
        await restoreSafetyCopy(
          databasePath,
          displacedPath,
          join(userDataPath, 'backups', 'POS-Safety-Before-Restore.sqlite')
        ).catch(() => undefined)
      }
      if (error instanceof BackupServiceError) {
        if (databaseClosed && !error.databaseClosed) {
          throw new BackupServiceError(error.code, error.message, true)
        }
        throw error
      }
      throw new BackupServiceError(
        'restore-failed',
        'The restore could not be completed. The safety copy is available in the app data folder.',
        databaseClosed
      )
    } finally {
      backupInProgress = false
    }
  }

  function currentTime(): Date {
    return options.now?.() ?? new Date()
  }

  return { getStatus, getLastAutomaticDate, setDestination, runManual, runAutomatic, restore }
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isSameWindowsVolume(firstPath: string, secondPath: string): boolean {
  const firstRoot = win32.parse(win32.resolve(firstPath)).root.toLowerCase()
  const secondRoot = win32.parse(win32.resolve(secondPath)).root.toLowerCase()
  return firstRoot === secondRoot
}

function isSameVolumeForCurrentPlatform(firstPath: string, secondPath: string): boolean {
  if (process.platform === 'win32') return isSameWindowsVolume(firstPath, secondPath)
  try {
    return statSync(firstPath).dev === statSync(secondPath).dev
  } catch {
    return false
  }
}

function isSameWindowsPath(firstPath: string, secondPath: string): boolean {
  return win32.resolve(firstPath).toLowerCase() === win32.resolve(secondPath).toLowerCase()
}

function assertDifferentVolume(
  databasePath: string,
  destinationPath: string,
  sameVolume = isSameWindowsVolume
): void {
  if (sameVolume(databasePath, destinationPath)) {
    throw new BackupServiceError(
      'same-drive',
      'Choose a backup folder on a different drive from the POS database.'
    )
  }
}

function validateBackupFile(path: string, supportedVersion: number): void {
  let backup: InstanceType<typeof Database> | undefined
  try {
    backup = new Database(path, { readonly: true, fileMustExist: true })
    validateBackupDatabase(backup, supportedVersion)
  } catch (error) {
    if (error instanceof BackupServiceError) throw error
    throw new BackupServiceError('invalid-backup', 'This file is not a valid POS database backup.')
  } finally {
    backup?.close()
  }
}

async function writeSnapshot(
  source: PosDatabase,
  destination: string,
  supportedVersion: number
): Promise<void> {
  await rm(destination, { force: true })
  await rm(`${destination}-wal`, { force: true })
  await rm(`${destination}-shm`, { force: true })
  await source.backup(destination)
  const snapshot = new Database(destination)
  try {
    snapshot.pragma('wal_checkpoint(TRUNCATE)')
    snapshot.pragma('journal_mode = DELETE')
  } finally {
    snapshot.close()
  }
  await rm(`${destination}-wal`, { force: true })
  await rm(`${destination}-shm`, { force: true })
  validateBackupFile(destination, supportedVersion)
}

function validateBackupDatabase(database: PosDatabase, supportedVersion: number): void {
  const integrity = database.pragma('integrity_check', { simple: true }) as string
  if (integrity !== 'ok') {
    throw new BackupServiceError('invalid-backup', 'The backup file failed its integrity check.')
  }
  const foreignKeyIssues = database.pragma('foreign_key_check') as unknown[]
  if (foreignKeyIssues.length > 0) {
    throw new BackupServiceError('invalid-backup', 'The backup contains broken data references.')
  }
  const version = database.pragma('user_version', { simple: true }) as number
  if (version > supportedVersion) {
    throw new BackupServiceError(
      'unsupported-version',
      'This backup was made by a newer version of the POS app. Update the app before restoring it.'
    )
  }
  if (version < 1) {
    throw new BackupServiceError(
      'invalid-backup',
      'The selected file does not contain a POS database.'
    )
  }
  const tables = new Set(
    (
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
    ).map((row) => row.name)
  )
  if (!['products', 'sales', 'settings'].every((table) => tables.has(table))) {
    throw new BackupServiceError('invalid-backup', 'The selected file is missing POS data tables.')
  }
}

function readConfig(path: string): BackupConfig {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<BackupConfig>
    return {
      ...emptyConfig,
      ...value,
      destinationPath: typeof value.destinationPath === 'string' ? value.destinationPath : null,
      lastBackupAt: typeof value.lastBackupAt === 'string' ? value.lastBackupAt : null,
      lastBackupKind:
        value.lastBackupKind === 'automatic' || value.lastBackupKind === 'manual'
          ? value.lastBackupKind
          : null,
      lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : null,
      lastAttemptStatus:
        value.lastAttemptStatus === 'success' || value.lastAttemptStatus === 'failed'
          ? value.lastAttemptStatus
          : null,
      lastAttemptError: typeof value.lastAttemptError === 'string' ? value.lastAttemptError : null,
      lastAutomaticDate:
        typeof value.lastAutomaticDate === 'string' ? value.lastAutomaticDate : null
    }
  } catch {
    return { ...emptyConfig }
  }
}

function saveConfig(path: string, value: BackupConfig): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8')
    renameSync(temporaryPath, path)
  } catch (error) {
    rmSyncQuietly(temporaryPath)
    throw error
  }
}

function rmSyncQuietly(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // Config cleanup is best effort after a failed atomic write.
  }
}

async function restoreSafetyCopy(
  databasePath: string,
  displacedPath: string,
  safetyCopyPath: string
): Promise<void> {
  try {
    await access(databasePath)
  } catch {
    await rename(displacedPath, databasePath).catch(async () => {
      await copyFile(safetyCopyPath, databasePath)
    })
  }
}
