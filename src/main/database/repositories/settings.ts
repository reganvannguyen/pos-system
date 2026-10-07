import type { PosDatabase, SettingsRecord } from '../types'

export function createSettingsRepository(database: PosDatabase) {
  const getStatement = database.prepare(
    `SELECT id, business_name, tax_rate_basis_points, printer_name, auto_print_receipt
     FROM settings
     WHERE id = 1`
  )

  return {
    get(): SettingsRecord {
      const settings = getStatement.get() as SettingsRecord | undefined
      if (!settings) throw new Error('The database is missing its default settings row.')
      return settings
    }
  }
}
