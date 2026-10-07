import type { PosDatabase, ProductRecord } from '../types'

export function createProductRepository(database: PosDatabase) {
  const listActiveStatement = database.prepare(
    `SELECT id, sku, name, price_cents, stock_quantity, is_active, created_at, updated_at
     FROM products
     WHERE is_active = 1
     ORDER BY name COLLATE NOCASE, id`
  )
  const findActiveBySkuStatement = database.prepare(
    `SELECT id, sku, name, price_cents, stock_quantity, is_active, created_at, updated_at
     FROM products
     WHERE sku = ? AND is_active = 1`
  )

  return {
    listActive(): ProductRecord[] {
      return listActiveStatement.all() as ProductRecord[]
    },
    findActiveBySku(sku: string): ProductRecord | undefined {
      return findActiveBySkuStatement.get(sku) as ProductRecord | undefined
    }
  }
}
