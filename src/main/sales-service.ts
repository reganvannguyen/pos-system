import type {
  CheckoutItem,
  CheckoutQuote,
  PaymentMethod,
  SaleDetail,
  SaleErrorCode,
  SaleResult,
  SaleSummary
} from '../shared/pos-api'
import type {
  SaleDetailRecord,
  SaleQuoteRecord,
  SaleSummaryRecord,
  SalesRepository
} from './database/repositories/sales'
import { SalesRepositoryError } from './database/repositories/sales'

export class SalesServiceError extends Error {
  constructor(
    readonly code: Exclude<SaleErrorCode, 'internal'>,
    message: string
  ) {
    super(message)
    this.name = 'SalesServiceError'
  }
}

export function createSalesService(repository: SalesRepository) {
  return {
    quote(value: unknown): CheckoutQuote {
      return toQuote(repository.quote(parseItems(value)))
    },

    completeCheckout(value: unknown): SaleDetail {
      if (!isRecord(value)) {
        throw new SalesServiceError('invalid-input', 'Enter a valid sale and payment method.')
      }
      if (value.paymentMethod !== 'cash' && value.paymentMethod !== 'card') {
        throw new SalesServiceError('invalid-input', 'Choose Cash or Card as the payment method.')
      }
      return toSaleDetail(
        repository.completeCheckout({
          items: parseItems(value.items),
          paymentMethod: value.paymentMethod as PaymentMethod
        })
      )
    },

    listRecent(): SaleSummary[] {
      return repository.listRecent(100).map(toSaleSummary)
    },

    getById(value: unknown): SaleDetail {
      const id = parseId(value)
      const detail = repository.getById(id)
      if (!detail) throw new SalesServiceError('not-found', 'This sale could not be found.')
      return toSaleDetail(detail)
    }
  }
}

export function toSalesResult<T>(operation: () => T): SaleResult<T> {
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    if (error instanceof SalesServiceError || error instanceof SalesRepositoryError) {
      return { ok: false, error: { code: error.code, message: error.message } }
    }

    console.error('Sales operation failed.', error)
    return {
      ok: false,
      error: { code: 'internal', message: 'Unable to complete the sales operation.' }
    }
  }
}

function parseItems(value: unknown): CheckoutItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SalesServiceError('invalid-input', 'Add at least one product to the cart.')
  }

  const seenProductIds = new Set<number>()
  return value.map((item) => {
    if (!isRecord(item)) {
      throw new SalesServiceError('invalid-input', 'The cart contains an invalid item.')
    }
    if (
      typeof item.productId !== 'number' ||
      !Number.isSafeInteger(item.productId) ||
      item.productId < 1
    ) {
      throw new SalesServiceError('invalid-input', 'The cart contains an invalid product.')
    }
    if (
      typeof item.quantity !== 'number' ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1
    ) {
      throw new SalesServiceError(
        'invalid-input',
        'Product quantities must be whole numbers above zero.'
      )
    }
    if (seenProductIds.has(item.productId)) {
      throw new SalesServiceError('invalid-input', 'Each product can appear only once in the cart.')
    }
    seenProductIds.add(item.productId)
    return { productId: item.productId, quantity: item.quantity }
  })
}

function parseId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new SalesServiceError('invalid-input', 'Choose a valid sale.')
  }
  return value
}

function toQuote(value: SaleQuoteRecord): CheckoutQuote {
  return {
    items: value.items.map((item) => ({
      productId: item.product_id,
      sku: item.sku,
      name: item.product_name,
      unitPriceCents: item.unit_price_cents,
      quantity: item.quantity,
      lineTotalCents: item.line_total_cents
    })),
    subtotalCents: value.subtotal_cents,
    taxCents: value.tax_cents,
    totalCents: value.total_cents
  }
}

function toSaleSummary(value: SaleSummaryRecord): SaleSummary {
  return {
    id: value.id,
    subtotalCents: value.subtotal_cents,
    taxCents: value.tax_cents,
    totalCents: value.total_cents,
    paymentMethod: value.payment_method,
    createdAt: value.created_at,
    itemCount: value.item_count
  }
}

function toSaleDetail(value: SaleDetailRecord): SaleDetail {
  return {
    ...toSaleSummary(value),
    items: value.items.map((item) => ({
      productId: item.product_id,
      sku: item.sku,
      name: item.product_name,
      unitPriceCents: item.unit_price_cents,
      quantity: item.quantity,
      lineTotalCents: item.line_total_cents
    }))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
