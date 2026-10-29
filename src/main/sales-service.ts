import type {
  CheckoutItem,
  CheckoutQuote,
  ChargePayment,
  ChargePaymentTenderType,
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
  ChargePaymentSummaryRecord,
  ProductReportLineRecord,
  ReturnQuoteRecord,
  DailyProductSummaryRecord,
  SaleDetailRecord,
  SaleQuoteRecord,
  SaleTaxReportRecord,
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

export interface SalesReportProductTotal {
  productId: number | null
  sku: string
  name: string
  netQuantity: number
  subtotalCents: number
  taxAmounts: Array<{ name: string; amountCents: number }>
  totalCents: number
  tenderAmounts: Record<'cash' | 'debit' | 'credit' | 'charge', number>
}

export interface SalesReportChargeRepayment {
  type: ChargePaymentTenderType
  amountCents: number
  createdAt: string
}

export interface SalesReportProductDetails {
  products: SalesReportProductTotal[]
  chargeRepayments: SalesReportChargeRepayment[]
}

interface MutableSalesReportProductTotal {
  productId: number | null
  sku: string
  name: string
  netQuantity: bigint
  subtotalCents: bigint
  taxAmounts: Map<string, bigint>
  tenderAmounts: Record<'cash' | 'debit' | 'credit' | 'charge', bigint>
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
      const customerId = parseOptionalCustomerId(value.customerId)
      const chargeRemainingBalance = parseOptionalBoolean(
        value.chargeRemainingBalance,
        'Charge the remaining balance'
      )
      if (chargeRemainingBalance && customerId === undefined) {
        throw new SalesServiceError(
          'invalid-input',
          'Select a customer before charging the remaining balance.'
        )
      }
      const sale = repository.completeCheckout({
        items: parseItems(value.items),
        tenders: parseTenders(value.tenders),
        ...(customerId !== undefined && { customerId }),
        ...(chargeRemainingBalance && { chargeRemainingBalance })
      })
      return { sale: toSaleDetail(sale) }
    },

    recordChargePayment(value: unknown): SaleDetail {
      if (!isRecord(value)) {
        throw new SalesServiceError('invalid-input', 'Enter valid charge payment details.')
      }
      const saleId = parseId(value.saleId)
      if (!isChargePaymentTenderType(value.type)) {
        throw new SalesServiceError(
          'invalid-input',
          'Choose Cash, Debit, Credit, E-Transfer, or Check.'
        )
      }
      if (
        typeof value.amountCents !== 'number' ||
        !Number.isSafeInteger(value.amountCents) ||
        value.amountCents <= 0
      ) {
        throw new SalesServiceError('invalid-input', 'Payment amounts must be above zero.')
      }
      return toSaleDetail(
        repository.recordChargePayment({
          saleId,
          type: value.type,
          amountCents: value.amountCents
        })
      )
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
        tenders: parsed.tenders,
        ...(parsed.customerId !== undefined && { customerId: parsed.customerId })
      })
      return { return: toSaleDetail(returned) }
    },

    listRecent(): SaleSummary[] {
      return repository.listRecent(100).map(toSaleSummary)
    },

    report(value: unknown): SalesReport {
      const period = resolveSalesPeriod(value)
      const transactions = repository.listInRange(period.startInclusive, period.endExclusive)
      const taxLinesBySale = new Map<number, SaleTaxReportRecord[]>()
      for (const taxLine of repository.taxLinesInRange(
        period.startInclusive,
        period.endExclusive
      )) {
        const lines = taxLinesBySale.get(taxLine.sale_id) ?? []
        lines.push(taxLine)
        taxLinesBySale.set(taxLine.sale_id, lines)
      }
      const taxTotalsByName = new Map<string, { sales: bigint; returns: bigint }>()
      const addTaxTotal = (name: string, amount: bigint, isReturn: boolean): void => {
        const current = taxTotalsByName.get(name) ?? { sales: 0n, returns: 0n }
        if (isReturn) current.returns -= amount
        else current.sales += amount
        taxTotalsByName.set(name, current)
      }
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
      let etransferReceived = 0n
      let checkReceived = 0n

      for (const transaction of transactions) {
        const isReturn = transaction.transaction_type === 'return'
        let itemizedTax = 0n
        for (const taxLine of taxLinesBySale.get(transaction.id) ?? []) {
          const amount = BigInt(taxLine.tax_cents)
          itemizedTax += amount
          addTaxTotal(taxLine.tax_name, amount, isReturn)
        }
        const unitemizedTax = BigInt(transaction.tax_cents) - itemizedTax
        if (unitemizedTax !== 0n) addTaxTotal('Unitemized tax', unitemizedTax, isReturn)

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

      for (const payment of repository.chargePaymentsInRange(
        period.startInclusive,
        period.endExclusive
      )) {
        if (payment.payment_type === 'cash') cashReceived += BigInt(payment.amount_cents)
        else if (payment.payment_type === 'debit') debitReceived += BigInt(payment.amount_cents)
        else if (payment.payment_type === 'credit') creditReceived += BigInt(payment.amount_cents)
        else if (payment.payment_type === 'etransfer') {
          etransferReceived += BigInt(payment.amount_cents)
        } else checkReceived += BigInt(payment.amount_cents)
      }

      const cardReceived = debitReceived + creditReceived
      const cardRefunded = debitRefunded + creditRefunded

      returnsSubtotal = -returnsSubtotal
      returnsTax = -returnsTax
      returnsTotal = -returnsTotal
      return {
        sales: transactions.map(toSaleSummary),
        taxTotals: [...taxTotalsByName.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([taxName, tax]) => ({
            taxName,
            salesTaxCents: toSafeReportTotal(tax.sales),
            returnsTaxCents: toSafeReportTotal(tax.returns),
            netTaxCents: toSafeReportTotal(tax.sales + tax.returns)
          })),
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
          cardNetCents: toSafeReportTotal(cardReceived - cardRefunded),
          etransferReceivedCents: toSafeReportTotal(etransferReceived),
          checkReceivedCents: toSafeReportTotal(checkReceived)
        }
      }
    },

    productsForDay(value: unknown): DailyProductSummary[] {
      const period = resolveSalesPeriod({ type: 'day', date: value })
      return repository
        .productTotalsInRange(period.startInclusive, period.endExclusive)
        .map(toDailyProductSummary)
    },

    productsInPeriod(value: unknown): DailyProductSummary[] {
      const period = resolveSalesPeriod(value)
      return repository
        .productTotalsInRange(period.startInclusive, period.endExclusive)
        .map(toDailyProductSummary)
    },

    productsWithFinancialsInPeriod(
      value: unknown,
      transactions: SaleSummary[]
    ): SalesReportProductDetails {
      const period = resolveSalesPeriod(value)
      const lines = repository.productLinesInRange(period.startInclusive, period.endExclusive)
      const linesBySaleId = new Map<number, ProductReportLineRecord[]>()
      for (const line of lines) {
        const saleLines = linesBySaleId.get(line.sale_id) ?? []
        saleLines.push(line)
        linesBySaleId.set(line.sale_id, saleLines)
      }

      const taxLinesBySaleId = new Map<number, SaleTaxReportRecord[]>()
      for (const tax of repository.taxLinesInRange(period.startInclusive, period.endExclusive)) {
        const saleTaxes = taxLinesBySaleId.get(tax.sale_id) ?? []
        saleTaxes.push(tax)
        taxLinesBySaleId.set(tax.sale_id, saleTaxes)
      }

      const productTotals = new Map<string, MutableSalesReportProductTotal>()
      for (const transaction of transactions) {
        const saleLines = linesBySaleId.get(transaction.id) ?? []
        if (saleLines.length === 0) continue
        const weights = saleLines.map((line) => BigInt(line.line_total_cents))
        const isReturn = transaction.transactionType === 'return'
        const signedTaxes = new Map<string, bigint>()
        let itemizedTaxCents = 0n
        for (const tax of taxLinesBySaleId.get(transaction.id) ?? []) {
          const amount = BigInt(tax.tax_cents)
          itemizedTaxCents += amount
          signedTaxes.set(
            tax.tax_name,
            (signedTaxes.get(tax.tax_name) ?? 0n) + (isReturn ? -amount : amount)
          )
        }
        const unitemizedTaxCents = BigInt(Math.abs(transaction.taxCents)) - itemizedTaxCents
        if (unitemizedTaxCents !== 0n) {
          signedTaxes.set(
            'Unitemized tax',
            (isReturn ? -unitemizedTaxCents : unitemizedTaxCents) +
              (signedTaxes.get('Unitemized tax') ?? 0n)
          )
        }

        const taxAllocations = new Map(
          [...signedTaxes].map(([name, amount]) => [name, allocateCents(amount, weights)])
        )
        const tenderAllocations = new Map<'cash' | 'debit' | 'credit', bigint[]>()
        for (const payment of transaction.payments) {
          const type = reportTenderType(payment.type)
          tenderAllocations.set(
            type,
            addAllocations(
              tenderAllocations.get(type),
              allocateCents(absoluteCents(BigInt(payment.amountAppliedCents)), weights)
            )
          )
        }
        const chargeAllocations = allocateCents(BigInt(transaction.chargeAmountCents ?? 0), weights)
        const sign = isReturn ? -1n : 1n
        const rowTotals = saleLines.map(
          (line, index) =>
            BigInt(line.line_total_cents) +
            [...taxAllocations.values()].reduce(
              (sum, allocations) => sum + (allocations[index] ?? 0n) * sign,
              0n
            )
        )
        reconcileTenderAllocations(tenderAllocations, chargeAllocations, rowTotals)

        saleLines.forEach((line, index) => {
          const key = reportProductKey(line)
          let total = productTotals.get(key)
          if (!total) {
            total = {
              productId: line.product_id,
              sku: line.sku,
              name: line.product_name,
              netQuantity: 0n,
              subtotalCents: 0n,
              taxAmounts: new Map(),
              tenderAmounts: { cash: 0n, debit: 0n, credit: 0n, charge: 0n }
            }
            productTotals.set(key, total)
          }
          total.netQuantity += sign * BigInt(line.quantity)
          total.subtotalCents += sign * BigInt(line.line_total_cents)
          for (const [name, allocations] of taxAllocations) {
            total.taxAmounts.set(
              name,
              (total.taxAmounts.get(name) ?? 0n) + (allocations[index] ?? 0n)
            )
          }
          for (const [type, allocations] of tenderAllocations) {
            total.tenderAmounts[type] += (allocations[index] ?? 0n) * sign
          }
          total.tenderAmounts.charge += (chargeAllocations[index] ?? 0n) * sign
        })
      }

      const products = [...productTotals.values()]
        .sort(
          (left, right) => left.name.localeCompare(right.name) || left.sku.localeCompare(right.sku)
        )
        .map((product): SalesReportProductTotal => {
          const taxAmounts = [...product.taxAmounts]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, amount]) => ({ name, amountCents: toSafeReportTotal(amount) }))
          const subtotalCents = toSafeReportTotal(product.subtotalCents)
          const taxTotalCents = [...product.taxAmounts.values()].reduce(
            (sum, amount) => sum + amount,
            0n
          )
          return {
            productId: product.productId,
            sku: product.sku,
            name: product.name,
            netQuantity: toSafeReportTotal(product.netQuantity),
            subtotalCents,
            taxAmounts,
            totalCents: toSafeReportTotal(product.subtotalCents + taxTotalCents),
            tenderAmounts: {
              cash: toSafeReportTotal(product.tenderAmounts.cash),
              debit: toSafeReportTotal(product.tenderAmounts.debit),
              credit: toSafeReportTotal(product.tenderAmounts.credit),
              charge: toSafeReportTotal(product.tenderAmounts.charge)
            }
          }
        })

      const chargeRepayments = repository
        .chargePaymentsInRange(period.startInclusive, period.endExclusive)
        .map(toSalesReportChargeRepayment)
      return { products, chargeRepayments }
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
    const quantity = parseQuantity(item.quantity)
    const priceOverride = parsePriceOverride(item.priceOverride)

    if ('customItem' in item) {
      if ('productId' in item) {
        throw new SalesServiceError('invalid-input', 'The cart contains an invalid item.')
      }
      return {
        customItem: parseCustomItem(item.customItem),
        quantity,
        ...(priceOverride && { priceOverride })
      }
    }

    const productId = parseProductId(item.productId)
    if (seenProductIds.has(productId)) {
      throw new SalesServiceError('invalid-input', 'Each product can appear only once in the cart.')
    }
    seenProductIds.add(productId)
    return { productId, quantity, ...(priceOverride && { priceOverride }) }
  })
}

function parseReturnRequest(
  value: unknown,
  includeTenders: boolean
): {
  items: ReturnItemInput[]
  reason: string
  tenders: TenderInput[]
  customerId?: number
} {
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
    const quantity = parseQuantity(item.quantity)
    if ('customItem' in item) {
      if ('productId' in item || item.restock !== false) {
        throw new SalesServiceError('invalid-input', 'Custom return items cannot be restocked.')
      }
      return {
        customItem: parseCustomItem(item.customItem),
        quantity,
        restock: false as const
      }
    }
    const productId = parseProductId(item.productId)
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
  const customerId = parseOptionalCustomerId(value.customerId)
  return {
    items,
    reason: value.reason.trim(),
    tenders: includeTenders ? parseTenders(value.tenders, true) : [],
    ...(customerId !== undefined && { customerId })
  }
}

function parseProductId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new SalesServiceError('invalid-input', 'The cart contains an invalid product.')
  }
  return value
}

function parseQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new SalesServiceError(
      'invalid-input',
      'Product quantities must be whole numbers above zero.'
    )
  }
  return value
}

function parseCustomItem(value: unknown): { name: string; unitPriceCents: number } {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim()) {
    throw new SalesServiceError('invalid-input', 'Enter a name for the custom item.')
  }
  if (
    typeof value.unitPriceCents !== 'number' ||
    !Number.isSafeInteger(value.unitPriceCents) ||
    value.unitPriceCents < 0
  ) {
    throw new SalesServiceError('invalid-input', 'Enter a non-negative price for the custom item.')
  }
  return { name: value.name.trim(), unitPriceCents: value.unitPriceCents }
}

function parsePriceOverride(value: unknown): CheckoutItem['priceOverride'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    throw new SalesServiceError('invalid-input', 'Enter a valid transaction price override.')
  }
  if (
    typeof value.unitPriceCents !== 'number' ||
    !Number.isSafeInteger(value.unitPriceCents) ||
    value.unitPriceCents < 0
  ) {
    throw new SalesServiceError(
      'invalid-input',
      'An override price must be a non-negative amount with up to two decimal places.'
    )
  }
  if (typeof value.reason !== 'string' || !value.reason.trim()) {
    throw new SalesServiceError('invalid-input', 'Enter a reason for the price change.')
  }
  return { unitPriceCents: value.unitPriceCents, reason: value.reason.trim() }
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

function parseOptionalCustomerId(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new SalesServiceError('invalid-input', 'Choose a valid customer.')
  }
  return value
}

function parseOptionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') {
    throw new SalesServiceError('invalid-input', `${label} must be true or false.`)
  }
  return value
}

function parseId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new SalesServiceError('invalid-input', 'Choose a valid transaction.')
  }
  return value
}

function isChargePaymentTenderType(value: unknown): value is ChargePaymentTenderType {
  return (
    value === 'cash' ||
    value === 'debit' ||
    value === 'credit' ||
    value === 'etransfer' ||
    value === 'check'
  )
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
  const charged = value.charge !== null
  const methodCount = Number(cashApplied > 0n) + Number(cardApplied > 0n) + Number(charged)
  const paymentMethod =
    methodCount > 1
      ? 'split'
      : cashApplied > 0n
        ? 'cash'
        : cardApplied > 0n
          ? 'card'
          : charged
            ? 'charge'
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
    chargeAmountCents: value.charge?.amount_cents ?? null,
    chargeBalanceCents: value.charge?.balance_cents ?? null,
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
    itemCount: value.item_count,
    customer:
      value.customer_id === null
        ? null
        : {
            id: value.customer_id,
            name:
              [value.customer_first_name, value.customer_last_name].filter(Boolean).join(' ') ||
              value.customer_company_name ||
              '',
            companyName: value.customer_company_name ?? ''
          }
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

function toSalesReportChargeRepayment(
  value: ChargePaymentSummaryRecord
): SalesReportChargeRepayment {
  return {
    type: value.payment_type,
    amountCents: value.amount_cents,
    createdAt: value.created_at
  }
}

function reportProductKey(line: ProductReportLineRecord): string {
  return line.product_id === null
    ? `snapshot:${JSON.stringify([line.sku, line.product_name])}`
    : `product:${line.product_id}`
}

function reportTenderType(
  type: SaleSummary['payments'][number]['type']
): 'cash' | 'debit' | 'credit' {
  if (type === 'cash') return 'cash'
  return type === 'debit' ? 'debit' : 'credit'
}

function addAllocations(current: bigint[] | undefined, incoming: bigint[]): bigint[] {
  return current ? current.map((amount, index) => amount + (incoming[index] ?? 0n)) : incoming
}

function absoluteCents(amount: bigint): bigint {
  return amount < 0n ? -amount : amount
}

function reconcileTenderAllocations(
  tenders: Map<'cash' | 'debit' | 'credit', bigint[]>,
  charge: bigint[],
  rowTotals: readonly bigint[]
): void {
  const allocations = [
    ...(['cash', 'debit', 'credit'] as const).flatMap((type) => {
      const amounts = tenders.get(type)
      return amounts ? [amounts] : []
    }),
    charge
  ]
  const allocatedTotal = allocations.reduce(
    (total, amounts) => total + amounts.reduce((sum, amount) => sum + amount, 0n),
    0n
  )
  if (allocatedTotal !== rowTotals.reduce((sum, amount) => sum + amount, 0n)) return

  const rowAllocated = rowTotals.map((_, index) =>
    allocations.reduce((sum, amounts) => sum + (amounts[index] ?? 0n), 0n)
  )
  for (let receiver = 0; receiver < rowTotals.length; receiver += 1) {
    while ((rowAllocated[receiver] ?? 0n) < (rowTotals[receiver] ?? 0n)) {
      const donor = rowTotals.findIndex(
        (_, index) => (rowAllocated[index] ?? 0n) > (rowTotals[index] ?? 0n)
      )
      if (donor < 0) return
      const tender = allocations.find((amounts) => (amounts[donor] ?? 0n) > 0n)
      if (!tender) return
      tender[donor] = (tender[donor] ?? 0n) - 1n
      tender[receiver] = (tender[receiver] ?? 0n) + 1n
      rowAllocated[donor] = (rowAllocated[donor] ?? 0n) - 1n
      rowAllocated[receiver] = (rowAllocated[receiver] ?? 0n) + 1n
    }
  }
}

function allocateCents(amount: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) return []
  const positiveWeights = weights.some((weight) => weight > 0n) ? weights : weights.map(() => 1n)
  const totalWeight = positiveWeights.reduce((sum, weight) => sum + weight, 0n)
  const sign = amount < 0n ? -1n : 1n
  const absoluteAmount = amount < 0n ? -amount : amount
  const remainders: Array<{ index: number; remainder: bigint }> = []
  const allocated = positiveWeights.map((weight, index) => {
    const numerator = absoluteAmount * weight
    remainders.push({ index, remainder: numerator % totalWeight })
    return numerator / totalWeight
  })
  const unallocated = Number(absoluteAmount - allocated.reduce((sum, part) => sum + part, 0n))
  remainders
    .sort((left, right) => {
      if (left.remainder === right.remainder) return left.index - right.index
      return left.remainder > right.remainder ? -1 : 1
    })
    .slice(0, unallocated)
    .forEach(({ index }) => {
      allocated[index] = (allocated[index] ?? 0n) + 1n
    })
  return allocated.map((part) => sign * part)
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
    })),
    charge: value.charge
      ? {
          customer: {
            name: value.charge.customer_name,
            companyName: value.charge.company_name,
            address: value.charge.address,
            phoneNumber: value.charge.phone_number,
            email: value.charge.email
          },
          amountCents: value.charge.amount_cents,
          balanceCents: value.charge.balance_cents,
          payments: value.charge.payments.map((payment): ChargePayment => ({
            type: payment.payment_type,
            amountCents: payment.amount_cents,
            createdAt: payment.created_at
          }))
        }
      : null
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
