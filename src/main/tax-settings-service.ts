import type {
  TaxRate,
  TaxSettingsApiError,
  TaxSettingsField,
  TaxSettingsResult
} from '../shared/pos-api'
import type { TaxRateRecord } from './database/types'
import type { TaxRepository } from './database/repositories/taxes'

export class TaxSettingsError extends Error {
  constructor(
    readonly code: 'invalid-input',
    message: string,
    readonly field?: TaxSettingsField,
    readonly index?: number
  ) {
    super(message)
    this.name = 'TaxSettingsError'
  }
}

export function createTaxSettingsService(repository: TaxRepository) {
  return {
    get(): TaxRate[] {
      return repository.list().map(toTaxRate)
    },

    save(value: unknown): TaxRate[] {
      const input = parseTaxSettings(value)
      const existingIds = new Set(repository.list().map(({ id }) => id))
      const seenIds = new Set<number>()
      const seenNames = new Set<string>()

      const taxes = input.map((tax, index) => {
        if (!isRecord(tax)) {
          throw new TaxSettingsError('invalid-input', 'Enter valid tax settings.', 'taxes', index)
        }
        if (
          tax.id !== undefined &&
          (typeof tax.id !== 'number' || !Number.isSafeInteger(tax.id) || tax.id < 1)
        ) {
          throw new TaxSettingsError('invalid-input', 'This tax entry is invalid.', 'name', index)
        }
        if (typeof tax.name !== 'string' || !tax.name.trim()) {
          throw new TaxSettingsError('invalid-input', 'Enter a tax name.', 'name', index)
        }
        const name = tax.name.trim()
        if (name.length > 60) {
          throw new TaxSettingsError(
            'invalid-input',
            'Tax names must be 60 characters or fewer.',
            'name',
            index
          )
        }
        const normalizedName = name.toLowerCase()
        if (seenNames.has(normalizedName)) {
          throw new TaxSettingsError('invalid-input', 'Tax names must be unique.', 'name', index)
        }
        seenNames.add(normalizedName)

        if (tax.id !== undefined) {
          if (!existingIds.has(tax.id) || seenIds.has(tax.id)) {
            throw new TaxSettingsError(
              'invalid-input',
              'The tax settings changed. Reload them and try again.',
              'name',
              index
            )
          }
          seenIds.add(tax.id)
        }

        if (typeof tax.ratePercent !== 'string') {
          throw new TaxSettingsError('invalid-input', 'Enter a tax rate.', 'ratePercent', index)
        }
        return {
          ...(tax.id !== undefined && { id: tax.id }),
          name,
          rateBasisPoints: parseTaxRate(tax.ratePercent, index)
        }
      })

      return repository.save(taxes).map(toTaxRate)
    }
  }
}

export function toTaxSettingsResult<T>(operation: () => T): TaxSettingsResult<T> {
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    if (error instanceof TaxSettingsError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.field && { field: error.field }),
          ...(error.index !== undefined && { index: error.index })
        }
      }
    }

    console.error('Tax settings operation failed.', error)
    const apiError: TaxSettingsApiError = {
      code: 'internal',
      message: 'Tax settings could not be read or saved.'
    }
    return { ok: false, error: apiError }
  }
}

function toTaxRate(value: TaxRateRecord): TaxRate {
  return { id: value.id, name: value.name, rateBasisPoints: value.rate_basis_points }
}

function parseTaxSettings(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.taxes)) {
    throw new TaxSettingsError('invalid-input', 'Enter valid tax settings.', 'taxes')
  }
  return value.taxes
}

function parseTaxRate(value: string, index: number): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) {
    throw new TaxSettingsError(
      'invalid-input',
      'Enter a tax rate from 0% to 100%, with no more than two decimal places.',
      'ratePercent',
      index
    )
  }
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (basisPoints > 10_000) {
    throw new TaxSettingsError(
      'invalid-input',
      'Enter a tax rate from 0% to 100%, with no more than two decimal places.',
      'ratePercent',
      index
    )
  }
  return basisPoints
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
