export const IPC_CHANNELS = {
  appGetVersion: 'app:get-version',
  productsList: 'products:list',
  productsGetBySku: 'products:get-by-sku',
  productsCreate: 'products:create',
  productsUpdate: 'products:update',
  productsSetActive: 'products:set-active',
  salesQuote: 'sales:quote',
  salesCompleteCheckout: 'sales:complete-checkout',
  salesListRecent: 'sales:list-recent',
  salesGetById: 'sales:get-by-id',
  printersList: 'printers:list',
  settingsGetReceipt: 'settings:get-receipt',
  settingsSaveReceipt: 'settings:save-receipt',
  receiptsPrint: 'receipts:print'
} as const

export type ProductStatus = 'active' | 'inactive'

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

export type PaymentMethod = 'cash' | 'card'

export interface CheckoutItem {
  productId: number
  quantity: number
}

export interface CheckoutRequest {
  items: CheckoutItem[]
  paymentMethod: PaymentMethod
}

export interface CheckoutQuoteItem {
  productId: number
  sku: string
  name: string
  unitPriceCents: number
  quantity: number
  lineTotalCents: number
}

export interface CheckoutQuote {
  items: CheckoutQuoteItem[]
  subtotalCents: number
  taxCents: number
  totalCents: number
}

export interface SaleSummary {
  id: number
  subtotalCents: number
  taxCents: number
  totalCents: number
  paymentMethod: PaymentMethod
  createdAt: string
  itemCount: number
}

export interface SaleItem {
  productId: number | null
  sku: string
  name: string
  unitPriceCents: number
  quantity: number
  lineTotalCents: number
}

export interface SaleDetail extends SaleSummary {
  items: SaleItem[]
}

export interface SaleCompletion {
  sale: SaleDetail
  autoPrintReceipt: boolean
}

export type SaleErrorCode =
  'invalid-input' | 'unavailable-product' | 'insufficient-stock' | 'not-found' | 'internal'

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
  autoPrintReceipt: boolean
}

export interface ReceiptPrintResult {
  saleId: number
  sentToPrinter: true
}

export type ReceiptErrorCode =
  | 'invalid-input'
  | 'printer-not-selected'
  | 'printer-unavailable'
  | 'sale-not-found'
  | 'print-failed'
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
  products: {
    list(options: ProductListOptions): Promise<ProductResult<Product[]>>
    getBySku(sku: string): Promise<ProductResult<Product | null>>
    create(input: ProductInput): Promise<ProductResult<Product>>
    update(id: number, input: ProductInput): Promise<ProductResult<Product>>
    setActive(id: number, isActive: boolean): Promise<ProductResult<Product>>
  }
  sales: {
    quote(items: CheckoutItem[]): Promise<SaleResult<CheckoutQuote>>
    completeCheckout(request: CheckoutRequest): Promise<SaleResult<SaleCompletion>>
    listRecent(): Promise<SaleResult<SaleSummary[]>>
    getById(id: number): Promise<SaleResult<SaleDetail>>
  }
  printers: {
    list(): Promise<ReceiptResult<PrinterOption[]>>
  }
  settings: {
    getReceipt(): Promise<ReceiptResult<ReceiptSettings>>
    saveReceipt(settings: ReceiptSettings): Promise<ReceiptResult<ReceiptSettings>>
  }
  receipts: {
    print(saleId: number): Promise<ReceiptResult<ReceiptPrintResult>>
  }
}
