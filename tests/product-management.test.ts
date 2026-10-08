import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { createProductRepository } from '../src/main/database/repositories/products'
import {
  createProductService,
  ProductServiceError,
  toProductResult
} from '../src/main/product-service'
import type { ProductInput } from '../src/shared/pos-api'

const schema = readFileSync(
  join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'),
  'utf8'
)

const validInput: ProductInput = {
  sku: 'APPLE-1',
  name: 'Apple',
  price: '1.25',
  stockQuantity: '4'
}

function withProductService(run: (service: ReturnType<typeof createProductService>) => void): void {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  try {
    run(createProductService(createProductRepository(database)))
  } finally {
    database.close()
  }
}

function assertServiceError(
  operation: () => unknown,
  code: ProductServiceError['code'],
  field?: ProductServiceError['field']
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof ProductServiceError)
    assert.equal(error.code, code)
    if (field) assert.equal(error.field, field)
    return true
  })
}

test('creates products with normalized SKUs, trimmed names, and integer cents', () => {
  withProductService((service) => {
    const product = service.create({
      ...validInput,
      sku: '  apple-1  ',
      name: '  Apple  ',
      price: '12.34'
    })

    assert.equal(product.sku, 'APPLE-1')
    assert.equal(product.name, 'Apple')
    assert.equal(product.priceCents, 1234)
    assert.equal(product.stockQuantity, 4)
    assert.equal(product.isActive, true)
    assert.equal(service.getBySku(' apple-1 ')?.id, product.id)
  })
})

test('stores zero price, zero stock, and untracked stock distinctly', () => {
  withProductService((service) => {
    const emptyShelf = service.create({ ...validInput, price: '0', stockQuantity: '0' })
    const untracked = service.create({ ...validInput, sku: 'APPLE-2', stockQuantity: '' })

    assert.equal(emptyShelf.priceCents, 0)
    assert.equal(emptyShelf.stockQuantity, 0)
    assert.equal(untracked.stockQuantity, null)
  })
})

test('rejects blank names, invalid prices, and non-integer stock with field errors', () => {
  withProductService((service) => {
    assertServiceError(() => service.create({ ...validInput, name: '  ' }), 'invalid-input', 'name')
    assertServiceError(
      () => service.create({ ...validInput, price: '-1.00' }),
      'invalid-input',
      'price'
    )
    assertServiceError(
      () => service.create({ ...validInput, price: '1.999' }),
      'invalid-input',
      'price'
    )
    assertServiceError(
      () => service.create({ ...validInput, stockQuantity: '1.5' }),
      'invalid-input',
      'stockQuantity'
    )
  })
})

test('returns field errors through the typed operation result', () => {
  withProductService((service) => {
    const result = toProductResult(() => service.create({ ...validInput, price: 'ten dollars' }))
    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'invalid-input',
        message: 'Enter a non-negative price with no more than two decimal places.',
        field: 'price'
      }
    })
  })
})

test('reserves SKUs across active and inactive products and excludes inactive lookup', () => {
  withProductService((service) => {
    const product = service.create({ ...validInput, sku: 'Mixed-Case' })
    service.setActive(product.id, false)

    assertServiceError(
      () => service.create({ ...validInput, sku: ' mixed-case ' }),
      'duplicate-sku',
      'sku'
    )
    assert.equal(service.getBySku('mixed-case'), null)
    assert.equal(service.list({ status: 'active', query: '' }).length, 0)
    assert.equal(service.list({ status: 'inactive', query: '' })[0]?.id, product.id)
  })
})

test('return SKU lookup includes inactive catalog products while sale lookup excludes them', () => {
  withProductService((service) => {
    const product = service.create({ ...validInput, sku: 'RETURNABLE' })
    service.setActive(product.id, false)

    assert.equal(service.getBySku('RETURNABLE'), null)
    assert.equal(service.getBySkuForReturn(' returnable ')?.id, product.id)
    assert.equal(service.getBySkuForReturn('missing'), null)
  })
})

test('releases the former SKU when an active product is edited', () => {
  withProductService((service) => {
    const product = service.create({ ...validInput, sku: 'OLD-SKU' })
    const updated = service.update(product.id, { ...validInput, sku: 'NEW-SKU' })
    const newProduct = service.create({ ...validInput, sku: 'OLD-SKU' })

    assert.equal(updated.sku, 'NEW-SKU')
    assert.equal(service.getBySku('OLD-SKU')?.id, newProduct.id)
  })
})

test('reactivates products and makes them available to active SKU lookup again', () => {
  withProductService((service) => {
    const product = service.create(validInput)
    service.setActive(product.id, false)
    const restored = service.setActive(product.id, true)

    assert.equal(restored.isActive, true)
    assert.equal(service.getBySku(product.sku)?.id, product.id)
    assert.equal(service.list({ status: 'active', query: 'apple' })[0]?.id, product.id)
    assert.equal(service.list({ status: 'inactive', query: '' }).length, 0)
  })
})

test('searches names and SKUs without case sensitivity within the chosen status', () => {
  withProductService((service) => {
    const first = service.create({ ...validInput, sku: 'DRINK-1', name: 'Coke Zero' })
    service.create({ ...validInput, sku: 'DRINK-2', name: 'Coke' })
    service.setActive(first.id, false)

    assert.equal(service.list({ status: 'active', query: 'cOkE' }).length, 1)
    assert.equal(service.list({ status: 'active', query: 'drink-2' })[0]?.sku, 'DRINK-2')
    assert.equal(service.list({ status: 'inactive', query: 'ZERO' })[0]?.id, first.id)
  })
})

test('reports missing products rather than silently updating or changing status', () => {
  withProductService((service) => {
    assertServiceError(() => service.update(999, validInput), 'not-found')
    assertServiceError(() => service.setActive(999, false), 'not-found')
  })
})
