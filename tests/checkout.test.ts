import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  allocateReturnPayouts,
  allocateTenders,
  centsInput,
  parseCadCents,
  tenderLabel,
  totalTenderedCents
} from '../src/renderer/src/checkout'

test('parses CAD amounts into exact cents without accepting fractions of a cent', () => {
  assert.equal(parseCadCents('12'), 1200)
  assert.equal(parseCadCents('12.5'), 1250)
  assert.equal(parseCadCents('12.50'), 1250)
  assert.equal(parseCadCents('0'), 0)
  assert.equal(parseCadCents(''), null)
  assert.equal(parseCadCents('-1'), null)
  assert.equal(parseCadCents('1.001'), null)
  assert.equal(parseCadCents('1,000'), null)
  assert.equal(parseCadCents('90071992547409.92'), null)
  assert.equal(centsInput(1005), '10.05')
})

test('labels current credit tender and keeps legacy sale labels readable', () => {
  assert.equal(tenderLabel('credit'), 'Credit')
  assert.equal(tenderLabel('mastercard'), 'Mastercard')
  assert.equal(tenderLabel('visa'), 'Visa')
})

test('allocates split tenders, tracks remaining, and allows cash change only', () => {
  const partial = allocateTenders(1000, [
    { type: 'cash', amountCents: 200 },
    { type: 'credit', amountCents: 300 }
  ])
  assert.deepEqual(partial, {
    valid: true,
    error: '',
    paidCents: 500,
    remainingCents: 500,
    changeCents: 0
  })

  const cashOverpayment = allocateTenders(1000, [{ type: 'cash', amountCents: 1200 }])
  assert.equal(cashOverpayment.remainingCents, 0)
  assert.equal(cashOverpayment.paidCents, 1000)
  assert.equal(cashOverpayment.changeCents, 200)

  const cardOverpayment = allocateTenders(1000, [{ type: 'credit', amountCents: 1200 }])
  assert.equal(cardOverpayment.valid, false)
  assert.match(cardOverpayment.error, /card payment cannot be greater/)
})

test('totals all tendered amounts before cash change is returned', () => {
  const exactPayment = [{ type: 'credit' as const, amountCents: 2239 }]
  assert.equal(totalTenderedCents(exactPayment), 2239)
  assert.equal(allocateTenders(2239, exactPayment).changeCents, 0)

  const cashOverpayment = [{ type: 'cash' as const, amountCents: 2739 }]
  assert.equal(totalTenderedCents(cashOverpayment), 2739)
  assert.equal(allocateTenders(2239, cashOverpayment).changeCents, 500)

  const splitPayment = [
    { type: 'debit' as const, amountCents: 1500 },
    { type: 'cash' as const, amountCents: 2000 }
  ]
  assert.equal(totalTenderedCents(splitPayment), 3500)
  assert.equal(allocateTenders(2239, splitPayment).changeCents, 1261)
})

test('return payout allocation supports partial and exact split refunds but rejects overpayment', () => {
  assert.deepEqual(allocateReturnPayouts(1000, [{ type: 'cash', amountCents: 400 }]), {
    valid: true,
    error: '',
    paidCents: 400,
    remainingCents: 600,
    changeCents: 0
  })
  assert.deepEqual(
    allocateReturnPayouts(1000, [
      { type: 'cash', amountCents: 400 },
      { type: 'credit', amountCents: 600 }
    ]),
    { valid: true, error: '', paidCents: 1000, remainingCents: 0, changeCents: 0 }
  )
  const overpayment = allocateReturnPayouts(1000, [{ type: 'cash', amountCents: 1001 }])
  assert.equal(overpayment.valid, false)
  assert.equal(overpayment.changeCents, 0)
})
