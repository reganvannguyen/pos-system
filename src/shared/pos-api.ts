export const IPC_CHANNELS = {
  appGetVersion: 'app:get-version',
  productsList: 'products:list',
  productsGetBySku: 'products:get-by-sku',
  productsCreate: 'products:create',
  productsUpdate: 'products:update',
  productsSetActive: 'products:set-active'
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
}
