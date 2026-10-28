import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { createCustomerService, toCustomerResult } from '../src/main/customer-service'
import { createCustomerRepository } from '../src/main/database/repositories/customers'

const schema =
  readFileSync(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') +
  readFileSync(join(process.cwd(), 'src/main/database/migrations/011_customers.sql'), 'utf8') +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/012_transaction_customers.sql'),
    'utf8'
  )

function withCustomerService<T>(run: (service: ReturnType<typeof createCustomerService>) => T): T {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  try {
    return run(createCustomerService(createCustomerRepository(database)))
  } finally {
    database.close()
  }
}

const validCustomer = {
  firstName: ' Alex ',
  lastName: ' Customer ',
  companyName: ' Example Studio ',
  address: ' 12 Main Street ',
  phoneNumber: ' 604-555-0100 ',
  email: ' alex@example.com ',
  imageDataUrl: 'data:image/png;base64,aGVsbG8='
}

test('creates, searches, and edits customer records', () => {
  withCustomerService((service) => {
    const created = service.create(validCustomer)
    assert.equal(created.firstName, 'Alex')
    assert.equal(created.lastName, 'Customer')
    assert.equal(created.companyName, 'Example Studio')
    assert.equal(created.address, '12 Main Street')
    assert.equal(created.phoneNumber, '604-555-0100')
    assert.equal(created.email, 'alex@example.com')
    assert.equal(created.imageDataUrl, validCustomer.imageDataUrl)
    assert.deepEqual(
      service.list('example studio').map(({ id, firstName }) => ({ id, firstName })),
      [{ id: created.id, firstName: 'Alex' }]
    )

    const updated = service.update(created.id, {
      ...validCustomer,
      firstName: 'Jamie',
      companyName: 'Updated Studio',
      imageDataUrl: null
    })
    assert.equal(updated.id, created.id)
    assert.equal(updated.firstName, 'Jamie')
    assert.equal(updated.companyName, 'Updated Studio')
    assert.equal(updated.imageDataUrl, null)
    assert.equal(service.list('604-555-0100')[0]?.id, created.id)
  })
})

test('validates required identity, email, image, and customer IDs', () => {
  withCustomerService((service) => {
    assert.deepEqual(
      toCustomerResult(() =>
        service.create({ ...validCustomer, firstName: '', lastName: '', companyName: '' })
      ),
      {
        ok: false,
        error: {
          code: 'invalid-input',
          message: 'Enter a first name, last name, or company name.',
          field: 'firstName'
        }
      }
    )
    assert.equal(
      toCustomerResult(() => service.create({ ...validCustomer, email: 'not-an-email' })).ok,
      false
    )
    assert.equal(
      toCustomerResult(() =>
        service.create({ ...validCustomer, imageDataUrl: 'data:image/gif;base64,aGVsbG8=' })
      ).ok,
      false
    )
    assert.equal(toCustomerResult(() => service.update(900, validCustomer)).ok, false)
  })
})
