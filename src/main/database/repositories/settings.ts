import type { PosDatabase, SettingsRecord } from '../types'

export function createSettingsRepository(database: PosDatabase) {
  const getStatement = database.prepare(
    `SELECT id, business_name, tax_rate_basis_points, printer_name, auto_print_receipt
     FROM settings
     WHERE id = 1`
  )
  const saveReceiptStatement = database.prepare(
    `UPDATE settings
     SET printer_name = @printerName, auto_print_receipt = @autoPrintReceipt
     WHERE id = 1`
  )
  const saveBusinessStatement = database.prepare(
    `UPDATE settings
     SET business_name = @businessName, tax_rate_basis_points = @taxRateBasisPoints
     WHERE id = 1`
  )

  return {
    get(): SettingsRecord {
      const settings = getStatement.get() as SettingsRecord | undefined
      if (!settings) throw new Error('The database is missing its default settings row.')
      return settings
    },
    saveReceipt(printerName: string | null, autoPrintReceipt: boolean): SettingsRecord {
      saveReceiptStatement.run({ printerName, autoPrintReceipt: autoPrintReceipt ? 1 : 0 })
      const settings = getStatement.get() as SettingsRecord | undefined
      if (!settings) throw new Error('The database is missing its default settings row.')
      return settings
    },
    saveBusiness(businessName: string, taxRateBasisPoints: number): SettingsRecord {
      saveBusinessStatement.run({ businessName, taxRateBasisPoints })
      const settings = getStatement.get() as SettingsRecord | undefined
      if (!settings) throw new Error('The database is missing its default settings row.')
      return settings
    }
  }
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>
