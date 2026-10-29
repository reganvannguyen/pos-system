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

export interface CustomerRecord {
  id: number
  first_name: string
  last_name: string
  company_name: string
  address: string
  phone_number: string
  email: string
  image_data_url: string | null
  created_at: string
  updated_at: string
}

export interface SaleRecord {
  id: number
  customer_id: number | null
  subtotal_cents: number
  tax_cents: number
  total_cents: number
  payment_method: 'cash' | 'card'
  transaction_type: 'sale' | 'return'
  transaction_number: string
  return_reason: string | null
  created_at: string
}

export interface SalePaymentRecord {
  id: number
  sale_id: number
  payment_type: 'cash' | 'debit' | 'credit' | 'mastercard' | 'visa' | 'card'
  amount_tendered_cents: number | null
  amount_applied_cents: number
  change_cents: number
}

export interface ChargePaymentRecord {
  id: number
  charge_id: number
  payment_type: 'cash' | 'debit' | 'credit' | 'etransfer' | 'check'
  amount_cents: number
  created_at: string
}

export interface SaleChargeRecord {
  id: number
  sale_id: number
  customer_name: string
  company_name: string
  address: string
  phone_number: string
  email: string
  amount_cents: number
  balance_cents: number
  payments: ChargePaymentRecord[]
}

export interface SaleItemRecord {
  id: number
  sale_id: number
  product_id: number | null
  sku: string
  product_name: string
  unit_price_cents: number
  original_unit_price_cents: number
  price_override_reason: string | null
  quantity: number
  line_total_cents: number
  restock_requested: 0 | 1
  restocked_quantity: number
}

export interface SettingsRecord {
  id: 1
  business_name: string
  business_email: string
  business_address: string
  business_city: string
  business_province: string
  business_postal_code: string
  business_phone: string
  business_gst_number: string
  business_website: string
  receipt_font_weight: number
  tax_rate_basis_points: number
  printer_name: string | null
  auto_print_receipt: 0 | 1
}

export interface TaxRateRecord {
  id: number
  name: string
  rate_basis_points: number
  sort_order: number
}
