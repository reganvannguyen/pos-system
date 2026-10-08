import type { BusinessSettingsInput } from '../../../shared/pos-api'
import type { PosDatabase, SettingsRecord } from '../types'

export function createSettingsRepository(database: PosDatabase) {
  const getStatement = database.prepare(
    `SELECT id, business_name, business_email, business_address, business_city, business_province,
            business_postal_code, business_phone, business_gst_number, business_website,
            tax_rate_basis_points, printer_name, auto_print_receipt
     FROM settings
     WHERE id = 1`
  )
  const saveReceiptStatement = database.prepare(
    `UPDATE settings
     SET printer_name = @printerName
     WHERE id = 1`
  )
  const saveBusinessStatement = database.prepare(
    `UPDATE settings
     SET business_name = @businessName,
         business_email = @businessEmail,
         business_address = @businessAddress,
         business_city = @businessCity,
         business_province = @businessProvince,
         business_postal_code = @businessPostalCode,
         business_phone = @businessPhone,
         business_gst_number = @businessGstNumber,
         business_website = @businessWebsite
     WHERE id = 1`
  )

  return {
    get(): SettingsRecord {
      const settings = getStatement.get() as SettingsRecord | undefined
      if (!settings) throw new Error('The database is missing its default settings row.')
      return settings
    },
    saveReceipt(printerName: string | null): SettingsRecord {
      saveReceiptStatement.run({ printerName })
      const settings = getStatement.get() as SettingsRecord | undefined
      if (!settings) throw new Error('The database is missing its default settings row.')
      return settings
    },
    saveBusiness(value: BusinessSettingsInput): SettingsRecord {
      saveBusinessStatement.run(value)
      const settings = getStatement.get() as SettingsRecord | undefined
      if (!settings) throw new Error('The database is missing its default settings row.')
      return settings
    }
  }
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>
