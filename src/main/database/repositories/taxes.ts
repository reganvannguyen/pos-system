import type { PosDatabase, TaxRateRecord } from '../types'

export interface TaxRateWriteData {
  id?: number
  name: string
  rateBasisPoints: number
}

export function createTaxRepository(database: PosDatabase) {
  const listStatement = database.prepare(
    `SELECT id, name, rate_basis_points, sort_order
     FROM tax_rates
     ORDER BY sort_order, id`
  )
  const getIdsStatement = database.prepare('SELECT id FROM tax_rates')
  const insertStatement = database.prepare(
    `INSERT INTO tax_rates (name, rate_basis_points, sort_order)
     VALUES (@name, @rateBasisPoints, @sortOrder)`
  )
  const updateStatement = database.prepare(
    `UPDATE tax_rates
     SET name = @name, rate_basis_points = @rateBasisPoints, sort_order = @sortOrder
     WHERE id = @id`
  )
  const deleteStatement = database.prepare('DELETE FROM tax_rates WHERE id = ?')

  const saveTransaction = database.transaction((taxes: TaxRateWriteData[]) => {
    const existingIds = new Set(
      (getIdsStatement.all() as Array<{ id: number }>).map(({ id }) => id)
    )
    const retainedIds = new Set<number>()

    for (const tax of taxes) {
      if (tax.id !== undefined) {
        if (!existingIds.has(tax.id) || retainedIds.has(tax.id)) {
          throw new Error('The tax settings changed. Reload them and try again.')
        }
        retainedIds.add(tax.id)
      }
    }

    for (const id of existingIds) {
      if (!retainedIds.has(id)) deleteStatement.run(id)
    }

    taxes.forEach((tax, sortOrder) => {
      const values = {
        name: tax.name,
        rateBasisPoints: tax.rateBasisPoints,
        sortOrder
      }
      if (tax.id === undefined) insertStatement.run(values)
      else updateStatement.run({ ...values, id: tax.id })
    })

    return listStatement.all() as TaxRateRecord[]
  })

  return {
    list(): TaxRateRecord[] {
      return listStatement.all() as TaxRateRecord[]
    },
    save(taxes: TaxRateWriteData[]): TaxRateRecord[] {
      return saveTransaction.immediate(taxes)
    }
  }
}

export type TaxRepository = ReturnType<typeof createTaxRepository>
