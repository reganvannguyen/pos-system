import type {
  BusinessSettings,
  BusinessSettingsApiError,
  BusinessSettingsField,
  BusinessSettingsResult
} from '../shared/pos-api'
import type { SettingsRepository } from './database/repositories/settings'

export class BusinessSettingsError extends Error {
  constructor(
    readonly code: 'invalid-input',
    message: string,
    readonly field?: BusinessSettingsField
  ) {
    super(message)
    this.name = 'BusinessSettingsError'
  }
}

export function createBusinessSettingsService(repository: SettingsRepository) {
  return {
    get(): BusinessSettings {
      return toBusinessSettings(repository.get())
    },

    save(value: unknown): BusinessSettings {
      if (!isRecord(value)) {
        throw new BusinessSettingsError('invalid-input', 'Enter receipt details.')
      }
      if (typeof value.businessName !== 'string' || !value.businessName.trim()) {
        throw new BusinessSettingsError('invalid-input', 'Enter a company name.', 'businessName')
      }
      const businessEmail = optionalString(value, 'businessEmail')
      if (businessEmail && !isValidEmail(businessEmail)) {
        throw new BusinessSettingsError(
          'invalid-input',
          'Enter a valid business email address or leave this field blank.',
          'businessEmail'
        )
      }
      const settings = {
        businessName: value.businessName.trim(),
        businessAddress: optionalString(value, 'businessAddress'),
        businessCity: optionalString(value, 'businessCity'),
        businessProvince: optionalString(value, 'businessProvince'),
        businessPostalCode: optionalString(value, 'businessPostalCode'),
        businessPhone: optionalString(value, 'businessPhone'),
        businessEmail,
        businessGstNumber: optionalString(value, 'businessGstNumber'),
        businessWebsite: optionalString(value, 'businessWebsite')
      }
      return toBusinessSettings(repository.saveBusiness(settings))
    }
  }
}

export function toBusinessSettingsResult<T>(operation: () => T): BusinessSettingsResult<T> {
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    if (error instanceof BusinessSettingsError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.field && { field: error.field })
        }
      }
    }

    console.error('Business settings operation failed.', error)
    const apiError: BusinessSettingsApiError = {
      code: 'internal',
      message: 'Receipt details could not be read or saved.'
    }
    return { ok: false, error: apiError }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function optionalString(
  value: Record<string, unknown>,
  field: Exclude<BusinessSettingsField, 'businessName'>
): string {
  const entry = value[field]
  if (entry === undefined || entry === null) return ''
  if (typeof entry !== 'string') {
    throw new BusinessSettingsError(
      'invalid-input',
      'Receipt details must be text or left blank.',
      field
    )
  }
  return entry.trim()
}

function toBusinessSettings(settings: ReturnType<SettingsRepository['get']>): BusinessSettings {
  return {
    businessName: settings.business_name,
    businessAddress: settings.business_address,
    businessCity: settings.business_city,
    businessProvince: settings.business_province,
    businessPostalCode: settings.business_postal_code,
    businessPhone: settings.business_phone,
    businessEmail: settings.business_email,
    businessGstNumber: settings.business_gst_number,
    businessWebsite: settings.business_website
  }
}
