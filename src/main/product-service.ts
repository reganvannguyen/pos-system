import type {
  Product,
  ProductErrorCode,
  ProductField,
  ProductListOptions,
  ProductResult,
  ProductStatus
} from '../shared/pos-api'
import type { ProductRecord } from './database/types'
import type { ProductRepository, ProductWriteData } from './database/repositories/products'

export class ProductServiceError extends Error {
  constructor(
    readonly code: Exclude<ProductErrorCode, 'internal'>,
    message: string,
    readonly field?: ProductField
  ) {
    super(message)
    this.name = 'ProductServiceError'
  }
}

export function createProductService(repository: ProductRepository) {
  return {
    list(options: unknown): Product[] {
      const { status, query } = parseListOptions(options)
      const isActive = status === 'active'
      const normalizedQuery = query.toLocaleLowerCase('en-CA')
      const normalizedSkuQuery = query.toUpperCase()

      return repository
        .listByStatus(isActive)
        .filter(
          (product) =>
            product.sku.includes(normalizedSkuQuery) ||
            product.name.toLocaleLowerCase('en-CA').includes(normalizedQuery)
        )
        .map(toProduct)
    },

    getBySku(value: unknown): Product | null {
      if (typeof value !== 'string') {
        throw new ProductServiceError('invalid-input', 'Enter a valid SKU.', 'sku')
      }

      const sku = normalizeSku(value)
      if (!sku) return null

      const product = repository.findActiveBySku(sku)
      return product ? toProduct(product) : null
    },

    create(value: unknown): Product {
      const product = parseProductInput(value)
      ensureSkuAvailable(repository, product.sku)

      try {
        return toProduct(repository.create(product))
      } catch (error) {
        if (isUniqueConstraintError(error)) throw duplicateSkuError()
        throw error
      }
    },

    update(idValue: unknown, value: unknown): Product {
      const id = parseId(idValue)
      if (!repository.getById(id)) throw notFoundError()

      const product = parseProductInput(value)
      ensureSkuAvailable(repository, product.sku, id)

      try {
        return toProduct(repository.update(id, product))
      } catch (error) {
        if (isUniqueConstraintError(error)) throw duplicateSkuError()
        throw error
      }
    },

    setActive(idValue: unknown, activeValue: unknown): Product {
      const id = parseId(idValue)
      if (typeof activeValue !== 'boolean') {
        throw new ProductServiceError('invalid-input', 'Choose a valid product status.')
      }

      if (!repository.getById(id)) throw notFoundError()
      return toProduct(repository.setActive(id, activeValue))
    }
  }
}

export function toProductResult<T>(operation: () => T): ProductResult<T> {
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    if (error instanceof ProductServiceError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.field && { field: error.field })
        }
      }
    }

    console.error('Product operation failed.', error)
    return {
      ok: false,
      error: { code: 'internal', message: 'Unable to complete the product operation.' }
    }
  }
}

function parseListOptions(value: unknown): ProductListOptions {
  if (!isRecord(value)) {
    throw new ProductServiceError('invalid-input', 'Choose a product status and search term.')
  }

  if (value.status !== 'active' && value.status !== 'inactive') {
    throw new ProductServiceError('invalid-input', 'Choose a valid product status.')
  }
  if (typeof value.query !== 'string') {
    throw new ProductServiceError('invalid-input', 'Enter a valid search term.')
  }

  return { status: value.status as ProductStatus, query: value.query.trim() }
}

function parseProductInput(value: unknown): ProductWriteData {
  if (!isRecord(value)) {
    throw new ProductServiceError('invalid-input', 'Enter the product details.')
  }

  if (typeof value.sku !== 'string' || !normalizeSku(value.sku)) {
    throw new ProductServiceError('invalid-input', 'Enter a SKU.', 'sku')
  }
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new ProductServiceError('invalid-input', 'Enter a product name.', 'name')
  }
  if (typeof value.price !== 'string') {
    throw new ProductServiceError('invalid-input', 'Enter a price in CAD.', 'price')
  }
  if (typeof value.stockQuantity !== 'string') {
    throw new ProductServiceError(
      'invalid-input',
      'Enter a whole stock quantity or leave it blank.',
      'stockQuantity'
    )
  }

  return {
    sku: normalizeSku(value.sku),
    name: value.name.trim(),
    priceCents: parsePrice(value.price),
    stockQuantity: parseStockQuantity(value.stockQuantity)
  }
}

function parsePrice(value: string): number {
  const normalized = value.trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized)
  if (!match) {
    throw new ProductServiceError(
      'invalid-input',
      'Enter a non-negative price with no more than two decimal places.',
      'price'
    )
  }

  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) {
    throw new ProductServiceError('invalid-input', 'Enter a valid price.', 'price')
  }
  return cents
}

function parseStockQuantity(value: string): number | null {
  const normalized = value.trim()
  if (!normalized) return null
  if (!/^\d+$/.test(normalized)) {
    throw new ProductServiceError(
      'invalid-input',
      'Enter a non-negative whole number or leave stock blank.',
      'stockQuantity'
    )
  }

  const quantity = Number(normalized)
  if (!Number.isSafeInteger(quantity)) {
    throw new ProductServiceError('invalid-input', 'Enter a valid stock quantity.', 'stockQuantity')
  }
  return quantity
}

function normalizeSku(value: string): string {
  return value.trim().toUpperCase()
}

function ensureSkuAvailable(repository: ProductRepository, sku: string, exceptId?: number): void {
  const existing = repository.findBySku(sku)
  if (existing && existing.id !== exceptId) throw duplicateSkuError()
}

function parseId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ProductServiceError('invalid-input', 'Choose a valid product.')
  }
  return value
}

function toProduct(value: ProductRecord | undefined): Product {
  if (!value) throw new Error('The product was not available after saving.')

  return {
    id: value.id,
    sku: value.sku,
    name: value.name,
    priceCents: value.price_cents,
    stockQuantity: value.stock_quantity,
    isActive: value.is_active === 1,
    createdAt: value.created_at,
    updatedAt: value.updated_at
  }
}

function duplicateSkuError(): ProductServiceError {
  return new ProductServiceError('duplicate-sku', 'That SKU is already reserved.', 'sku')
}

function notFoundError(): ProductServiceError {
  return new ProductServiceError('not-found', 'This product no longer exists.')
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
