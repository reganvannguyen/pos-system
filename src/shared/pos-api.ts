export const IPC_CHANNELS = {
  appGetVersion: 'app:get-version',
  customersList: 'customers:list',
  customersCreate: 'customers:create',
  customersUpdate: 'customers:update',
  productsList: 'products:list',
  productsGetBySku: 'products:get-by-sku',
  productsGetBySkuForReturn: 'products:get-by-sku-for-return',
  productsCreate: 'products:create',
  productsUpdate: 'products:update',
  productsSetActive: 'products:set-active',
  salesQuote: 'sales:quote',
  salesCompleteCheckout: 'sales:complete-checkout',
  salesQuoteReturn: 'sales:quote-return',
  salesCompleteReturn: 'sales:complete-return',
  salesRecordChargePayment: 'sales:record-charge-payment',
  salesListRecent: 'sales:list-recent',
  salesReport: 'sales:report',
  salesProductsForDay: 'sales:products-for-day',
  salesExportCsv: 'sales:export-csv',
  salesExportPdf: 'sales:export-pdf',
  salesGetById: 'sales:get-by-id',
  printersList: 'printers:list',
  settingsGetReceipt: 'settings:get-receipt',
  settingsSaveReceipt: 'settings:save-receipt',
  settingsGetBusiness: 'settings:get-business',
  settingsSaveBusiness: 'settings:save-business',
  settingsGetTaxes: 'settings:get-taxes',
  settingsSaveTaxes: 'settings:save-taxes',
  backupsGetStatus: 'backups:get-status',
  backupsChooseDestination: 'backups:choose-destination',
  backupsRunManual: 'backups:run-manual',
  backupsRestore: 'backups:restore',
  receiptsPrint: 'receipts:print',
  receiptsPrintTest: 'receipts:print-test',
  receiptsEmailDraft: 'receipts:email-draft',
  receiptsTextDraft: 'receipts:text-draft',
  receiptsOpenPdf: 'receipts:open-pdf',
  receiptsViewPdf: 'receipts:view-pdf'
} as const

export type ProductStatus = 'active' | 'inactive'

export interface Customer {
  id: number
  firstName: string
  lastName: string
  companyName: string
  address: string
  phoneNumber: string
  email: string
  imageDataUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface CustomerInput {
  firstName: string
  lastName: string
  companyName: string
  address: string
  phoneNumber: string
  email: string
  imageDataUrl: string | null
}

export type CustomerField = keyof CustomerInput

export interface CustomerApiError {
  code: 'invalid-input' | 'not-found' | 'internal'
  message: string
  field?: CustomerField
}

export type CustomerResult<T> = { ok: true; data: T } | { ok: false; error: CustomerApiError }

export interface Product {
  id: number
  sku: string
  name: string
  priceCents: number
  stockQuantity: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProductInput {
  sku: string
  name: string
  price: string
  stockQuantity: string
}

export interface ProductListOptions {
  status: ProductStatus
  query: string
}

export type ProductField = 'sku' | 'name' | 'price' | 'stockQuantity'
export type ProductErrorCode = 'invalid-input' | 'duplicate-sku' | 'not-found' | 'internal'

export interface ProductApiError {
  code: ProductErrorCode
  message: string
  field?: ProductField
}

export type ProductResult<T> = { ok: true; data: T } | { ok: false; error: ProductApiError }

export type TenderType = 'cash' | 'debit' | 'credit'
export type ChargePaymentTenderType = TenderType | 'etransfer' | 'check'
export type SavedTenderType = TenderType | 'mastercard' | 'visa' | 'card'
export type PaymentMethod = 'cash' | 'card' | 'charge' | 'split' | 'none'

export interface ChargeCustomer {
  name: string
  companyName: string
  address: string
  phoneNumber: string
  email: string
}

export interface ChargePayment {
  type: ChargePaymentTenderType
  amountCents: number
  createdAt: string
}

export interface ChargeDetails {
  customer: ChargeCustomer
  amountCents: number
  balanceCents: number
  payments: ChargePayment[]
}

export interface ChargePaymentRequest {
  saleId: number
  type: ChargePaymentTenderType
  amountCents: number
}

export interface PriceOverrideInput {
  unitPriceCents: number
  reason: string
}

export interface CustomItemInput {
  name: string
  unitPriceCents: number
}

export type CheckoutItem =
  | {
      productId: number
      quantity: number
      priceOverride?: PriceOverrideInput
    }
  | {
      customItem: CustomItemInput
      quantity: number
      priceOverride?: PriceOverrideInput
    }

export interface CatalogReturnItemInput {
  productId: number
  quantity: number
  restock: boolean
}

export interface TenderInput {
  type: TenderType
  amountCents: number
}

export interface CheckoutRequest {
  items: CheckoutItem[]
  tenders: TenderInput[]
  customerId?: number
  chargeRemainingBalance?: boolean
}

export type ReturnItemInput =
  CatalogReturnItemInput | { customItem: CustomItemInput; quantity: number; restock: false }

export interface ReturnQuoteRequest {
  items: ReturnItemInput[]
  reason: string
}

export interface ReturnRequest extends ReturnQuoteRequest {
  tenders: TenderInput[]
  customerId?: number
}

export interface CheckoutQuoteItem {
  productId: number | null
  sku: string
  name: string
  catalogUnitPriceCents: number
  unitPriceCents: number
  priceOverrideReason: string | null
  quantity: number
  lineTotalCents: number
}

export interface CheckoutQuote {
  items: CheckoutQuoteItem[]
  subtotalCents: number
  taxBreakdown: SaleTax[]
  taxCents: number
  totalCents: number
}

export interface ReturnQuote extends CheckoutQuote {
  items: Array<CheckoutQuoteItem & { restock: boolean }>
  /** Return amounts are negative; quantities remain positive. */
  returnReason: string
}

export interface SaleTax {
  name: string
  rateBasisPoints: number
  taxCents: number
}

export interface SaleSummary {
  id: number
  customer: SaleCustomerSummary | null
  transactionNumber: string
  transactionType: 'sale' | 'return'
  returnReason: string | null
  subtotalCents: number
  taxCents: number
  totalCents: number
  paymentMethod: PaymentMethod
  chargeAmountCents: number | null
  chargeBalanceCents: number | null
  payments: SalePayment[]
  createdAt: string
  itemCount: number
}

export interface SaleCustomerSummary {
  id: number
  name: string
  companyName: string
}

export interface SalePayment {
  type: SavedTenderType
  amountTenderedCents: number | null
  amountAppliedCents: number
  changeCents: number
}

export type SalesPeriod =
  | { type: 'day'; date: string }
  | { type: 'week'; date: string }
  | { type: 'month'; month: string }
  | { type: 'year'; year: number }
  | { type: 'custom'; startDate: string; endDate: string }

export interface SalesReportTotals {
  transactionCount: number
  saleCount: number
  returnCount: number
  grossSalesSubtotalCents: number
  grossSalesTaxCents: number
  grossSalesTotalCents: number
  returnsSubtotalCents: number
  returnsTaxCents: number
  returnsTotalCents: number
  netSubtotalCents: number
  netTaxCents: number
  netTotalCents: number
  cashReceivedCents: number
  cashRefundedCents: number
  cashNetCents: number
  debitReceivedCents: number
  debitRefundedCents: number
  debitNetCents: number
  creditReceivedCents: number
  creditRefundedCents: number
  creditNetCents: number
  cardReceivedCents: number
  cardRefundedCents: number
  cardNetCents: number
  etransferReceivedCents: number
  checkReceivedCents: number
}

export interface SalesReportTaxTotal {
  taxName: string
  salesTaxCents: number
  returnsTaxCents: number
  netTaxCents: number
}

export interface SalesReport {
  sales: SaleSummary[]
  totals: SalesReportTotals
  taxTotals: SalesReportTaxTotal[]
}

export type SalesSummaryGroup =
  | 'overview'
  | 'gross'
  | 'returns'
  | 'cash'
  | 'debit'
  | 'credit'
  | 'card'
  | 'etransfer'
  | 'check'
  | 'net'

export interface DailyProductSummary {
  productId: number | null
  sku: string
  name: string
  netQuantity: number
  netAmountCents: number
}

export type SalesCsvExportResult = { canceled: true } | { canceled: false; rowCount: number }
export type SalesPdfExportResult = { canceled: true } | { canceled: false; rowCount: number }
export type SalesPdfReportType = 'summary' | 'itemized'

export interface SaleItem {
  productId: number | null
  sku: string
  name: string
  originalUnitPriceCents: number
  unitPriceCents: number
  priceOverrideReason: string | null
  quantity: number
  lineTotalCents: number
  restockRequested: boolean
  restockedQuantity: number
}

export interface SaleDetail extends SaleSummary {
  items: SaleItem[]
  payments: SalePayment[]
  taxBreakdown: SaleTax[]
  charge: ChargeDetails | null
}

export interface SaleCompletion {
  sale: SaleDetail
}

export interface ReturnCompletion {
  return: SaleDetail
}

export type SaleErrorCode =
  | 'invalid-input'
  | 'unavailable-product'
  | 'insufficient-stock'
  | 'not-found'
  | 'invalid-period'
  | 'insufficient-payment'
  | 'export-failed'
  | 'internal'

export interface SaleApiError {
  code: SaleErrorCode
  message: string
}

export type SaleResult<T> = { ok: true; data: T } | { ok: false; error: SaleApiError }

export interface PrinterOption {
  name: string
  displayName: string
  description: string
}

export interface ReceiptSettings {
  printerName: string | null
}

export interface ReceiptBusinessDetails {
  businessName: string
  businessAddress: string
  businessCity: string
  businessProvince: string
  businessPostalCode: string
  businessPhone: string
  businessEmail: string
  businessGstNumber: string
  businessWebsite: string
  receiptFontWeight: number
}

export type BusinessSettings = ReceiptBusinessDetails

export type BusinessSettingsInput = ReceiptBusinessDetails

export type BusinessSettingsField = keyof ReceiptBusinessDetails

export interface BusinessSettingsApiError {
  code: 'invalid-input' | 'internal'
  message: string
  field?: BusinessSettingsField
}

export type BusinessSettingsResult<T> =
  { ok: true; data: T } | { ok: false; error: BusinessSettingsApiError }

export interface TaxRate {
  id: number
  name: string
  rateBasisPoints: number
}

export interface TaxRateInput {
  id?: number
  name: string
  ratePercent: string
}

export interface TaxSettingsInput {
  taxes: TaxRateInput[]
}

export type TaxSettingsField = 'taxes' | 'name' | 'ratePercent'

export interface TaxSettingsApiError {
  code: 'invalid-input' | 'internal'
  message: string
  field?: TaxSettingsField
  index?: number
}

export type TaxSettingsResult<T> = { ok: true; data: T } | { ok: false; error: TaxSettingsApiError }

export type BackupKind = 'automatic' | 'manual'

export interface BackupStatus {
  destinationPath: string | null
  lastBackupAt: string | null
  lastBackupKind: BackupKind | null
  lastAttemptAt: string | null
  lastAttemptStatus: 'success' | 'failed' | null
  lastAttemptError: string | null
}

export interface BackupApiError {
  code:
    | 'not-configured'
    | 'same-drive'
    | 'unavailable'
    | 'invalid-backup'
    | 'unsupported-version'
    | 'restore-failed'
    | 'internal'
  message: string
}

export type BackupResult<T> = { ok: true; data: T } | { ok: false; error: BackupApiError }

export interface ReceiptTestPrintResult {
  sentToPrinter: true
}

export interface ReceiptPrintResult {
  saleId: number
  sentToPrinter: true
}

export interface ReceiptEmailDraftResult {
  saleId: number
  draftOpened: boolean
  attachmentIncluded: boolean
  subject: string
  body: string
}

export interface ReceiptTextDraftResult {
  saleId: number
  draftOpened: boolean
  message: string
}

export interface ReceiptPdfResult {
  saleId: number
  opened: true
}

export type ReceiptErrorCode =
  | 'invalid-input'
  | 'printer-not-selected'
  | 'printer-unavailable'
  | 'sale-not-found'
  | 'print-failed'
  | 'pdf-failed'
  | 'internal'

export interface ReceiptApiError {
  code: ReceiptErrorCode
  message: string
}

export type ReceiptResult<T> = { ok: true; data: T } | { ok: false; error: ReceiptApiError }

export interface PosApi {
  app: {
    getVersion(): Promise<string>
  }
  customers: {
    list(query: string): Promise<CustomerResult<Customer[]>>
    create(input: CustomerInput): Promise<CustomerResult<Customer>>
    update(id: number, input: CustomerInput): Promise<CustomerResult<Customer>>
  }
  products: {
    list(options: ProductListOptions): Promise<ProductResult<Product[]>>
    getBySku(sku: string): Promise<ProductResult<Product | null>>
    getBySkuForReturn(sku: string): Promise<ProductResult<Product | null>>
    create(input: ProductInput): Promise<ProductResult<Product>>
    update(id: number, input: ProductInput): Promise<ProductResult<Product>>
    setActive(id: number, isActive: boolean): Promise<ProductResult<Product>>
  }
  sales: {
    quote(items: CheckoutItem[]): Promise<SaleResult<CheckoutQuote>>
    completeCheckout(request: CheckoutRequest): Promise<SaleResult<SaleCompletion>>
    quoteReturn(request: ReturnQuoteRequest): Promise<SaleResult<ReturnQuote>>
    completeReturn(request: ReturnRequest): Promise<SaleResult<ReturnCompletion>>
    recordChargePayment(request: ChargePaymentRequest): Promise<SaleResult<SaleDetail>>
    listRecent(): Promise<SaleResult<SaleSummary[]>>
    report(period: SalesPeriod): Promise<SaleResult<SalesReport>>
    productsForDay(date: string): Promise<SaleResult<DailyProductSummary[]>>
    exportCsv(period: SalesPeriod): Promise<SaleResult<SalesCsvExportResult>>
    exportPdf(
      period: SalesPeriod,
      summaryGroups: SalesSummaryGroup[],
      reportType?: SalesPdfReportType
    ): Promise<SaleResult<SalesPdfExportResult>>
    getById(id: number): Promise<SaleResult<SaleDetail>>
  }
  printers: {
    list(): Promise<ReceiptResult<PrinterOption[]>>
  }
  settings: {
    getReceipt(): Promise<ReceiptResult<ReceiptSettings>>
    saveReceipt(settings: ReceiptSettings): Promise<ReceiptResult<ReceiptSettings>>
    getBusiness(): Promise<BusinessSettingsResult<BusinessSettings>>
    saveBusiness(settings: BusinessSettingsInput): Promise<BusinessSettingsResult<BusinessSettings>>
    getTaxes(): Promise<TaxSettingsResult<TaxRate[]>>
    saveTaxes(settings: TaxSettingsInput): Promise<TaxSettingsResult<TaxRate[]>>
  }
  backups: {
    getStatus(): Promise<BackupResult<BackupStatus>>
    chooseDestination(): Promise<BackupResult<BackupStatus>>
    runManual(): Promise<BackupResult<BackupStatus>>
    restore(): Promise<BackupResult<{ restored: boolean }>>
  }
  receipts: {
    printTest(): Promise<ReceiptResult<ReceiptTestPrintResult>>
    print(saleId: number): Promise<ReceiptResult<ReceiptPrintResult>>
    emailDraft(saleId: number, recipient: string): Promise<ReceiptResult<ReceiptEmailDraftResult>>
    textDraft(saleId: number, recipient: string): Promise<ReceiptResult<ReceiptTextDraftResult>>
    openPdf(saleId: number): Promise<ReceiptResult<ReceiptPdfResult>>
    viewPdf(saleId: number): Promise<ReceiptResult<ReceiptPdfResult>>
  }
}
