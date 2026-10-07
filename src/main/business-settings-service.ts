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
      const settings = repository.get()
      return {
        businessName: settings.business_name,
        taxRateBasisPoints: settings.tax_rate_basis_points
      }
    },

    save(value: unknown): BusinessSettings {
      if (!isRecord(value)) {
        throw new BusinessSettingsError('invalid-input', 'Enter business settings.')
      }
      if (typeof value.businessName !== 'string' || !value.businessName.trim()) {
        throw new BusinessSettingsError('invalid-input', 'Enter a business name.', 'businessName')
      }
      if (typeof value.taxRatePercent !== 'string') {
        throw new BusinessSettingsError('invalid-input', 'Enter a tax rate.', 'taxRatePercent')
      }

      const taxRateBasisPoints = parseTaxRate(value.taxRatePercent)
      const settings = repository.saveBusiness(value.businessName.trim(), taxRateBasisPoints)
      return {
        businessName: settings.business_name,
        taxRateBasisPoints: settings.tax_rate_basis_points
      }
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
      message: 'Business settings could not be read or saved.'
    }
    return { ok: false, error: apiError }
  }
}

function parseTaxRate(value: string): number {
  const normalized = value.trim()
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized)
  if (!match) {
    throw new BusinessSettingsError(
      'invalid-input',
      'Enter a tax rate from 0% to 100%, with no more than two decimal places.',
      'taxRatePercent'
    )
  }

  const wholePercent = Number(match[1])
  const fractionalPercent = Number((match[2] ?? '').padEnd(2, '0'))
  const basisPoints = wholePercent * 100 + fractionalPercent
  if (basisPoints > 10_000) {
    throw new BusinessSettingsError(
      'invalid-input',
      'Enter a tax rate from 0% to 100%, with no more than two decimal places.',
      'taxRatePercent'
    )
  }
  return basisPoints
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
