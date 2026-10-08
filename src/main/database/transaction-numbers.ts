import type { PosDatabase } from './types'

export function formatLocalDatePrefix(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function nextTransactionNumber(database: PosDatabase, date: Date): string {
  const prefix = formatLocalDatePrefix(date)
  const result = database
    .prepare(
      `SELECT MAX(CAST(substr(transaction_number, 10) AS INTEGER)) AS last_sequence
       FROM sales
       WHERE transaction_number >= @lowerBound AND transaction_number < @upperBound`
    )
    .get({ lowerBound: `${prefix}-0000`, upperBound: `${prefix}-\uffff` }) as {
    last_sequence: number | null
  }
  const sequence = (result.last_sequence ?? 0) + 1
  if (!Number.isSafeInteger(sequence)) {
    throw new Error('The daily transaction number sequence is too large.')
  }
  return `${prefix}-${String(sequence).padStart(4, '0')}`
}

export function backfillTransactionNumbers(database: PosDatabase): void {
  const rows = database
    .prepare('SELECT id, created_at FROM sales ORDER BY created_at, id')
    .all() as Array<{ id: number; created_at: string }>
  const sequencesByDate = new Map<string, number>()
  const updateStatement = database.prepare(
    'UPDATE sales SET transaction_number = @transactionNumber WHERE id = @id'
  )

  for (const row of rows) {
    const createdAt = new Date(`${row.created_at.replace(' ', 'T')}Z`)
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error(`Cannot assign a transaction number to record ${row.id}: invalid date.`)
    }

    const prefix = formatLocalDatePrefix(createdAt)
    const sequence = (sequencesByDate.get(prefix) ?? 0) + 1
    sequencesByDate.set(prefix, sequence)
    updateStatement.run({
      id: row.id,
      transactionNumber: `${prefix}-${String(sequence).padStart(4, '0')}`
    })
  }
}
