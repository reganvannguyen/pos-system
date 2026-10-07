import type { PosDatabase, ProductRecord } from '../types'

export interface ProductWriteData {
  sku: string
  name: string
  priceCents: number
  stockQuantity: number | null
}

const productColumns = `id, sku, name, price_cents, stock_quantity, is_active, created_at, updated_at`

export function createProductRepository(database: PosDatabase) {
  const listByStatusStatement = database.prepare(
    `SELECT ${productColumns}
     FROM products
     WHERE is_active = ?
     ORDER BY name COLLATE NOCASE, sku, id`
  )
  const findBySkuStatement = database.prepare(
    `SELECT ${productColumns}
     FROM products
     WHERE sku = ?`
  )
  const findActiveBySkuStatement = database.prepare(
    `SELECT ${productColumns}
     FROM products
     WHERE sku = ? AND is_active = 1`
  )
  const getByIdStatement = database.prepare(
    `SELECT ${productColumns}
     FROM products
     WHERE id = ?`
  )
  const insertStatement = database.prepare(
    `INSERT INTO products (sku, name, price_cents, stock_quantity)
     VALUES (@sku, @name, @priceCents, @stockQuantity)`
  )
  const updateStatement = database.prepare(
    `UPDATE products
     SET sku = @sku,
         name = @name,
         price_cents = @priceCents,
         stock_quantity = @stockQuantity,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @id`
  )
  const setActiveStatement = database.prepare(
    `UPDATE products
     SET is_active = @isActive,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @id`
  )

  function getById(id: number): ProductRecord | undefined {
    return getByIdStatement.get(id) as ProductRecord | undefined
  }

  return {
    listByStatus(isActive: boolean): ProductRecord[] {
      return listByStatusStatement.all(Number(isActive)) as ProductRecord[]
    },
    findBySku(sku: string): ProductRecord | undefined {
      return findBySkuStatement.get(sku) as ProductRecord | undefined
    },
    findActiveBySku(sku: string): ProductRecord | undefined {
      return findActiveBySkuStatement.get(sku) as ProductRecord | undefined
    },
    getById,
    create(product: ProductWriteData): ProductRecord | undefined {
      const result = insertStatement.run(product)
      return getById(Number(result.lastInsertRowid))
    },
    update(id: number, product: ProductWriteData): ProductRecord | undefined {
      updateStatement.run({ ...product, id })
      return getById(id)
    },
    setActive(id: number, isActive: boolean): ProductRecord | undefined {
      setActiveStatement.run({ id, isActive: Number(isActive) })
      return getById(id)
    }
  }
}

export type ProductRepository = ReturnType<typeof createProductRepository>
