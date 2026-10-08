import type {
  CheckoutItem,
  CheckoutQuote,
  DailyProductSummary,
  ReturnItemInput,
  ReturnQuote,
  SaleCompletion,
  SaleDetail,
  SaleErrorCode,
  SalesReport,
  SaleResult,
  SaleSummary,
  TenderInput
} from '../shared/pos-api'
import type {
  ReturnQuoteRecord,
  DailyProductSummaryRecord,
  SaleDetailRecord,
  SaleQuoteRecord,
  SaleSummaryRecord,
  SalesRepository
} from './database/repositories/sales'
import { SalesRepositoryError } from './database/repositories/sales'
import { resolveSalesPeriod, SalesPeriodError } from './sales-period'

export class SalesServiceError extends Error {
  constructor(
    readonly code: Exclude<SaleErrorCode, 'internal'>,
    message: string
  ) {
    super(message)
    this.name = 'SalesServiceError'
  }
}

export interface DailyProductBreakdown {
  date: string
  products: DailyProductSummary[]
}

export function createSalesService(repository: SalesRepository) {
  return {
    quote(value: unknown): CheckoutQuote {
      return toQuote(repository.quote(parseItems(value)))
    },

    completeCheckout(value: unknown): SaleCompletion {
      if (!isRecord(value)) {
        throw new SalesServiceError('invalid-input', 'Enter a valid sale and payment entries.')
      }
      const sale = repository.completeCheckout({
        items: parseItems(value.items),
        tenders: parseTenders(value.tenders)
      })
      return { sale: toSaleDetail(sale) }
    },

    quoteReturn(value: unknown): ReturnQuote {
      const parsed = parseReturnRequest(value, false)
      return toReturnQuote(repository.quoteReturn(parsed.items), parsed.reason)
    },

    completeReturn(value: unknown): { return: SaleDetail } {
      const parsed = parseReturnRequest(value, true)
      const returned = repository.completeReturn({
        items: parsed.items,
        reason: parsed.reason,
        tenders: parsed.tenders
      })
      return { return: toSaleDetail(returned) }
    },

    listRecent(): SaleSummary[] {
      return repository.listRecent(100).map(toSaleSummary)
    },

    report(value: unknown): SalesReport {
      const period = resolveSalesPeriod(value)
      const transactions = repository.listInRange(period.startInclusive, period.endExclusive)
      let saleCount = 0
      let returnCount = 0
      let grossSubtotal = 0n
      let grossTax = 0n
      let grossTotal = 0n
      let returnsSubtotal = 0n
      let returnsTax = 0n
      let returnsTotal = 0n
      let cashReceived = 0n
      let cashRefunded = 0n
      let debitReceived = 0n
      let debitRefunded = 0n
      let creditReceived = 0n
      let creditRefunded = 0n

      for (const transaction of transactions) {
        const isReturn = transaction.transaction_type === 'return'
        if (isReturn) {
          returnCount += 1
          returnsSubtotal += BigInt(transaction.subtotal_cents)
          returnsTax += BigInt(transaction.tax_cents)
          returnsTotal += BigInt(transaction.total_cents)
        } else {
          saleCount += 1
          grossSubtotal += BigInt(transaction.subtotal_cents)
          grossTax += BigInt(transaction.tax_cents)
          grossTotal += BigInt(transaction.total_cents)
        }

        for (const payment of transaction.payments) {
          if (payment.payment_type === 'cash') {
            if (isReturn) cashRefunded += BigInt(payment.amount_applied_cents)
            else cashReceived += BigInt(payment.amount_applied_cents)
          } else if (payment.payment_type === 'debit') {
            if (isReturn) debitRefunded += BigInt(payment.amount_applied_cents)
            else debitReceived += BigInt(payment.amount_applied_cents)
          } else {
            // Older saved card, Visa, and Mastercard tenders have no reliable debit/credit subtype.
            // Keep them in the credit bucket so the debit and credit totals still reconcile to card.
            if (isReturn) creditRefunded += BigInt(payment.amount_applied_cents)
            else creditReceived += BigInt(payment.amount_applied_cents)
          }
        }
      }

      const cardReceived = debitReceived + creditReceived
      const cardRefunded = debitRefunded + creditRefunded

      returnsSubtotal = -returnsSubtotal
      returnsTax = -returnsTax
      returnsTotal = -returnsTotal
      return {
        sales: transactions.map(toSaleSummary),
        totals: {
          transactionCount: transactions.length,
          saleCount,
          returnCount,
          grossSalesSubtotalCents: toSafeReportTotal(grossSubtotal),
          grossSalesTaxCents: toSafeReportTotal(grossTax),
          grossSalesTotalCents: toSafeReportTotal(grossTotal),
          returnsSubtotalCents: toSafeReportTotal(returnsSubtotal),
          returnsTaxCents: toSafeReportTotal(returnsTax),
          returnsTotalCents: toSafeReportTotal(returnsTotal),
          netSubtotalCents: toSafeReportTotal(grossSubtotal + returnsSubtotal),
          netTaxCents: toSafeReportTotal(grossTax + returnsTax),
          netTotalCents: toSafeReportTotal(grossTotal + returnsTotal),
          cashReceivedCents: toSafeReportTotal(cashReceived),
          cashRefundedCents: toSafeReportTotal(cashRefunded),
          cashNetCents: toSafeReportTotal(cashReceived - cashRefunded),
          debitReceivedCents: toSafeReportTotal(debitReceived),
          debitRefundedCents: toSafeReportTotal(debitRefunded),
          debitNetCents: toSafeReportTotal(debitReceived - debitRefunded),
          creditReceivedCents: toSafeReportTotal(creditReceived),
          creditRefundedCents: toSafeReportTotal(creditRefunded),
          creditNetCents: toSafeReportTotal(creditReceived - creditRefunded),
          cardReceivedCents: toSafeReportTotal(cardReceived),
          cardRefundedCents: toSafeReportTotal(cardRefunded),
          cardNetCents: toSafeReportTotal(cardReceived - cardRefunded)
        }
      }
    },

    productsForDay(value: unknown): DailyProductSummary[] {
      const period = resolveSalesPeriod({ type: 'day', date: value })
      return repository
        .productTotalsInRange(period.startInclusive, period.endExclusive)
        .map(toDailyProductSummary)
    },

    productsByDayInPeriod(value: unknown): DailyProductBreakdown[] {
      const period = resolveSalesPeriod(value)
      const dailyRecords = repository.productTotalsByLocalDayInRange(
        period.startInclusive,
        period.endExclusive
      )
      const byDate = new Map<string, DailyProductSummary[]>()
      for (const record of dailyRecords) {
        const products = byDate.get(record.local_date) ?? []
        products.push(toDailyProductSummary(record))
        byDate.set(record.local_date, products)
      }
      return [...byDate].map(([date, products]) => ({ date, products }))
    },

    getById(value: unknown): SaleDetail {
      const id = parseId(value)
      const detail = repository.getById(id)
      if (!detail) throw new SalesServiceError('not-found', 'This transaction could not be found.')
      return toSaleDetail(detail)
    }
  }
}

export type SalesService = ReturnType<typeof createSalesService>

export function toSalesResult<T>(operation: () => T): SaleResult<T> {
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    return toSalesError(error)
  }
}

export async function toSalesResultAsync<T>(operation: () => Promise<T>): Promise<SaleResult<T>> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    return toSalesError(error)
  }
}

function toSalesError<T>(error: unknown): SaleResult<T> {
  if (
    error instanceof SalesServiceError ||
    error instanceof SalesRepositoryError ||
    error instanceof SalesPeriodError
  ) {
    return { ok: false, error: { code: error.code, message: error.message } }
  }

  console.error('Sales operation failed.', error)
  return {
    ok: false,
    error: { code: 'internal', message: 'Unable to complete the sales operation.' }
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
    const { productId, quantity } = parseProductAndQuantity(item)
    if (seenProductIds.has(productId)) {
      throw new SalesServiceError('invalid-input', 'Each product can appear only once in the cart.')
    }
    seenProductIds.add(productId)
    let priceOverride: CheckoutItem['priceOverride']
    if (item.priceOverride !== undefined) {
      if (!isRecord(item.priceOverride)) {
        throw new SalesServiceError('invalid-input', 'Enter a valid transaction price override.')
      }
      if (
        typeof item.priceOverride.unitPriceCents !== 'number' ||
        !Number.isSafeInteger(item.priceOverride.unitPriceCents) ||
        item.priceOverride.unitPriceCents < 0
      ) {
        throw new SalesServiceError(
          'invalid-input',
          'An override price must be a non-negative amount with up to two decimal places.'
        )
      }
      if (typeof item.priceOverride.reason !== 'string' || !item.priceOverride.reason.trim()) {
        throw new SalesServiceError('invalid-input', 'Enter a reason for the price change.')
      }
      priceOverride = {
        unitPriceCents: item.priceOverride.unitPriceCents,
        reason: item.priceOverride.reason.trim()
      }
    }
    return { productId, quantity, ...(priceOverride && { priceOverride }) }
  })
}

function parseReturnRequest(
  value: unknown,
  includeTenders: boolean
): { items: ReturnItemInput[]; reason: string; tenders: TenderInput[] } {
  if (!isRecord(value)) {
    throw new SalesServiceError('invalid-input', 'Enter the return details.')
  }
  if (typeof value.reason !== 'string' || !value.reason.trim()) {
    throw new SalesServiceError('invalid-input', 'Enter a reason for this return.')
  }
  if (!Array.isArray(value.items) || value.items.length === 0) {
    throw new SalesServiceError('invalid-input', 'Add at least one product to the return.')
  }
  const seenProductIds = new Set<number>()
  const items = value.items.map((item) => {
    if (!isRecord(item)) {
      throw new SalesServiceError('invalid-input', 'The return contains an invalid item.')
    }
    if ('priceOverride' in item) {
      throw new SalesServiceError(
        'invalid-input',
        'Return prices must use the current catalog price.'
      )
    }
    const { productId, quantity } = parseProductAndQuantity(item)
    if (typeof item.restock !== 'boolean') {
      throw new SalesServiceError('invalid-input', 'Choose whether to restock each returned item.')
    }
    if (seenProductIds.has(productId)) {
      throw new SalesServiceError(
        'invalid-input',
        'Each product can appear only once in the return.'
      )
    }
    seenProductIds.add(productId)
    return { productId, quantity, restock: item.restock }
  })
  return {
    items,
    reason: value.reason.trim(),
    tenders: includeTenders ? parseTenders(value.tenders, true) : []
  }
}

function parseProductAndQuantity(item: Record<string, unknown>): {
  productId: number
  quantity: number
} {
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
  return { productId: item.productId, quantity: item.quantity }
}

function parseTenders(value: unknown, isReturn = false): TenderInput[] {
  if (!Array.isArray(value)) {
    throw new SalesServiceError(
      'invalid-input',
      isReturn
        ? 'Add valid refund amounts for this return.'
        : 'Add valid payment amounts for this sale.'
    )
  }
  return value.map((tender) => {
    if (!isRecord(tender)) {
      throw new SalesServiceError('invalid-input', 'A payment entry is invalid.')
    }
    if (tender.type !== 'cash' && tender.type !== 'debit' && tender.type !== 'credit') {
      throw new SalesServiceError('invalid-input', 'Choose Cash, Debit, or Credit.')
    }
    if (
      typeof tender.amountCents !== 'number' ||
      !Number.isSafeInteger(tender.amountCents) ||
      tender.amountCents <= 0
    ) {
      throw new SalesServiceError(
        'invalid-input',
        isReturn ? 'Refund amounts must be above zero.' : 'Payment amounts must be above zero.'
      )
    }
    return { type: tender.type, amountCents: tender.amountCents }
  })
}

function parseId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new SalesServiceError('invalid-input', 'Choose a valid transaction.')
  }
  return value
}

function toQuote(value: SaleQuoteRecord): CheckoutQuote {
  return {
    items: value.items.map((item) => ({
      productId: item.product_id,
      sku: item.sku,
      name: item.product_name,
      catalogUnitPriceCents: item.catalog_unit_price_cents,
      unitPriceCents: item.unit_price_cents,
      priceOverrideReason: item.price_override_reason,
      quantity: item.quantity,
      lineTotalCents: item.line_total_cents
    })),
    subtotalCents: value.subtotal_cents,
    taxBreakdown: value.tax_breakdown.map((tax) => ({
      name: tax.tax_name,
      rateBasisPoints: tax.rate_basis_points,
      taxCents: tax.tax_cents
    })),
    taxCents: value.tax_cents,
    totalCents: value.total_cents
  }
}

function toReturnQuote(value: ReturnQuoteRecord, reason: string): ReturnQuote {
  return {
    items: value.items.map((item) => ({
      productId: item.product_id,
      sku: item.sku,
      name: item.product_name,
      catalogUnitPriceCents: negativeAmount(item.catalog_unit_price_cents),
      unitPriceCents: negativeAmount(item.unit_price_cents),
      priceOverrideReason: null,
      quantity: item.quantity,
      lineTotalCents: negativeAmount(item.line_total_cents),
      restock: item.restock
    })),
    subtotalCents: negativeAmount(value.subtotal_cents),
    taxBreakdown: value.tax_breakdown.map((tax) => ({
      name: tax.tax_name,
      rateBasisPoints: tax.rate_basis_points,
      taxCents: negativeAmount(tax.tax_cents)
    })),
    taxCents: negativeAmount(value.tax_cents),
    totalCents: negativeAmount(value.total_cents),
    returnReason: reason
  }
}

function toSaleSummary(value: SaleSummaryRecord): SaleSummary {
  let cashApplied = 0n
  let cardApplied = 0n
  for (const payment of value.payments) {
    if (payment.payment_type === 'cash') cashApplied += BigInt(payment.amount_applied_cents)
    else cardApplied += BigInt(payment.amount_applied_cents)
  }
  const paymentMethod =
    cashApplied > 0n && cardApplied > 0n
      ? 'split'
      : cashApplied > 0n
        ? 'cash'
        : cardApplied > 0n
          ? 'card'
          : value.payments.length > 0
            ? value.payment_method
            : 'none'
  const isReturn = value.transaction_type === 'return'
  return {
    id: value.id,
    transactionNumber: value.transaction_number,
    transactionType: value.transaction_type,
    returnReason: value.return_reason,
    subtotalCents: signedAmount(value.subtotal_cents, isReturn),
    taxCents: signedAmount(value.tax_cents, isReturn),
    totalCents: signedAmount(value.total_cents, isReturn),
    paymentMethod,
    payments: value.payments.map((payment) => ({
      type: payment.payment_type,
      amountTenderedCents:
        payment.amount_tendered_cents === null
          ? null
          : signedAmount(payment.amount_tendered_cents, isReturn),
      amountAppliedCents: signedAmount(payment.amount_applied_cents, isReturn),
      changeCents: payment.change_cents
    })),
    createdAt: value.created_at,
    itemCount: value.item_count
  }
}

function toDailyProductSummary(value: DailyProductSummaryRecord): DailyProductSummary {
  return {
    productId: value.product_id,
    sku: value.sku,
    name: value.product_name,
    netQuantity: value.net_quantity,
    netAmountCents: value.net_amount_cents
  }
}

function toSaleDetail(value: SaleDetailRecord): SaleDetail {
  const isReturn = value.transaction_type === 'return'
  return {
    ...toSaleSummary(value),
    items: value.items.map((item) => ({
      productId: item.product_id,
      sku: item.sku,
      name: item.product_name,
      originalUnitPriceCents: signedAmount(item.original_unit_price_cents, isReturn),
      unitPriceCents: signedAmount(item.unit_price_cents, isReturn),
      priceOverrideReason: item.price_override_reason,
      quantity: item.quantity,
      lineTotalCents: signedAmount(item.line_total_cents, isReturn),
      restockRequested: item.restock_requested === 1,
      restockedQuantity: item.restocked_quantity
    })),
    taxBreakdown: value.tax_breakdown.map((tax) => ({
      name: tax.tax_name,
      rateBasisPoints: tax.rate_basis_points,
      taxCents: signedAmount(tax.tax_cents, isReturn)
    }))
  }
}

function negativeAmount(value: number): number {
  return value === 0 ? 0 : -value
}

function signedAmount(value: number, isReturn: boolean): number {
  return isReturn ? negativeAmount(value) : value
}

function toSafeReportTotal(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('The sales report total is too large to process.')
  }
  return Number(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
