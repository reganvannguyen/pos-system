import initialSchema from './migrations/001_initial_schema.sql?raw'
import multipleTaxRates from './migrations/002_multiple_tax_rates.sql?raw'
import tendersAndPriceOverrides from './migrations/003_tenders_and_price_overrides.sql?raw'
import creditTenderType from './migrations/004_credit_tender_type.sql?raw'
import businessEmail from './migrations/005_business_email.sql?raw'
import receiptBusinessDetails from './migrations/006_receipt_business_details.sql?raw'
import standaloneReturns from './migrations/007_standalone_returns.sql?raw'
import transactionNumbers from './migrations/008_transaction_numbers.sql?raw'
import saleCharges from './migrations/009_sale_charges.sql?raw'
import chargePaymentTenders from './migrations/010_charge_payment_tenders.sql?raw'
import customers from './migrations/011_customers.sql?raw'
import transactionCustomers from './migrations/012_transaction_customers.sql?raw'
import receiptFontWeight from './migrations/013_receipt_font_weight.sql?raw'
import { backfillTransactionNumbers } from './transaction-numbers'
import type { PosDatabase } from './types'

interface Migration {
  version: number
  sql: string
  afterSql?: (database: PosDatabase) => void
}

const migrations: Migration[] = [
  { version: 1, sql: initialSchema },
  { version: 2, sql: multipleTaxRates },
  { version: 3, sql: tendersAndPriceOverrides },
  { version: 4, sql: creditTenderType },
  { version: 5, sql: businessEmail },
  { version: 6, sql: receiptBusinessDetails },
  { version: 7, sql: standaloneReturns },
  { version: 8, sql: transactionNumbers, afterSql: backfillTransactionNumbers },
  { version: 9, sql: saleCharges },
  { version: 10, sql: chargePaymentTenders },
  { version: 11, sql: customers },
  { version: 12, sql: transactionCustomers },
  { version: 13, sql: receiptFontWeight }
]

export function runMigrations(database: PosDatabase): void {
  let currentVersion = database.pragma('user_version', { simple: true }) as number
  const latestVersion = migrations.at(-1)?.version ?? 0

  if (currentVersion > latestVersion) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than this app supports (${latestVersion}).`
    )
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue
    if (migration.version !== currentVersion + 1) {
      throw new Error(`Missing migration for database schema version ${currentVersion + 1}.`)
    }

    database.transaction(() => {
      database.exec(migration.sql)
      migration.afterSql?.(database)
      database.pragma(`user_version = ${migration.version}`)
    })()

    currentVersion = migration.version
  }
}
