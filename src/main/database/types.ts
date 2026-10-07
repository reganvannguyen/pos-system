import type BetterSqlite3 from 'better-sqlite3'

export type PosDatabase = InstanceType<typeof BetterSqlite3>

export interface ProductRecord {
  id: number
  sku: string
  name: string
  price_cents: number
  stock_quantity: number | null
  is_active: 0 | 1
  created_at: string
  updated_at: string
}

export interface SaleRecord {
  id: number
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  payment_method: 'cash' | 'card'
  created_at: string
}

export interface SettingsRecord {
  id: 1
  business_name: string
  tax_rate_basis_points: number
  printer_name: string | null
  auto_print_receipt: 0 | 1
}
