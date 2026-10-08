import type { SavedTenderType, TenderInput } from '../../shared/pos-api'

export interface CheckoutSession {
  tenders: TenderInput[]
}

export interface TenderSummary {
  valid: boolean
  error: string
  paidCents: number
  remainingCents: number
  changeCents: number
}

export function parseCadCents(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null
  const [dollars = '', fraction = ''] = trimmed.split('.')
  try {
    const cents = BigInt(dollars) * 100n + BigInt(fraction.padEnd(2, '0') || '0')
    if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return Number(cents)
  } catch {
    return null
  }
}

export function centsInput(value: number): string {
  return (value / 100).toFixed(2)
}

export function totalTenderedCents(tenders: TenderInput[]): number {
  return tenders.reduce((sum, tender) => sum + tender.amountCents, 0)
}

export function allocateTenders(totalCents: number, tenders: TenderInput[]): TenderSummary {
  let remainingCents = totalCents
  let changeCents = 0

  for (const tender of tenders) {
    if (!Number.isSafeInteger(tender.amountCents) || tender.amountCents <= 0) {
      return {
        valid: false,
        error: 'Payment amounts must be above zero.',
        paidCents: totalCents - remainingCents,
        remainingCents,
        changeCents
      }
    }
    if (remainingCents <= 0) {
      return {
        valid: false,
        error: 'Remove extra payments before completing this sale.',
        paidCents: totalCents,
        remainingCents: 0,
        changeCents
      }
    }
    if (tender.type !== 'cash' && tender.amountCents > remainingCents) {
      return {
        valid: false,
        error: 'A card payment cannot be greater than the remaining balance.',
        paidCents: totalCents - remainingCents,
        remainingCents,
        changeCents
      }
    }

    const applied = Math.min(tender.amountCents, remainingCents)
    if (tender.type === 'cash') changeCents += tender.amountCents - applied
    remainingCents -= applied
  }

  return {
    valid: true,
    error: '',
    paidCents: totalCents - remainingCents,
    remainingCents,
    changeCents
  }
}

export function allocateReturnPayouts(totalCents: number, tenders: TenderInput[]): TenderSummary {
  let remainingCents = totalCents
  let paidCents = 0
  for (const tender of tenders) {
    if (!Number.isSafeInteger(tender.amountCents) || tender.amountCents <= 0) {
      return {
        valid: false,
        error: 'Refund amounts must be above zero.',
        paidCents,
        remainingCents,
        changeCents: 0
      }
    }
    if (tender.amountCents > remainingCents) {
      return {
        valid: false,
        error: 'Refund payouts cannot be greater than the remaining return amount.',
        paidCents,
        remainingCents,
        changeCents: 0
      }
    }
    remainingCents -= tender.amountCents
    paidCents += tender.amountCents
  }
  return { valid: true, error: '', paidCents, remainingCents, changeCents: 0 }
}

export function tenderLabel(type: SavedTenderType): string {
  if (type === 'mastercard') return 'Mastercard'
  if (type === 'credit') return 'Credit'
  if (type === 'debit') return 'Debit'
  if (type === 'visa') return 'Visa'
  if (type === 'card') return 'Card (type unknown)'
  return 'Cash'
}
