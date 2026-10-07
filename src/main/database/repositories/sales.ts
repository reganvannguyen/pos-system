import type { PosDatabase, SaleRecord } from '../types'

export function createSalesRepository(database: PosDatabase) {
  const listRecentStatement = database.prepare(
    `SELECT id, subtotal_cents, tax_cents, total_cents, payment_method, created_at
     FROM sales
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  )

  return {
    listRecent(limit = 100): SaleRecord[] {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('The sales limit must be a positive integer.')
      }

      return listRecentStatement.all(limit) as SaleRecord[]
    }
  }
}
