import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Product } from '../src/shared/pos-api'
import {
  addProductToCart,
  calculateSubtotalCents,
  changeCartQuantity,
  clearCart,
  removeCartProduct
} from '../src/renderer/src/cart'

const apple: Product = {
  id: 1,
  sku: 'APPLE-1',
  name: 'Apple',
  priceCents: 125,
  stockQuantity: 0,
  isActive: true,
  createdAt: '',
  updatedAt: ''
}

const juice: Product = {
  ...apple,
  id: 2,
  sku: 'JUICE-1',
  name: 'Juice',
  priceCents: 250
}

test('adds one product line with its price snapshot', () => {
  const cart = addProductToCart([], apple)

  assert.deepEqual(cart, [
    { productId: 1, sku: 'APPLE-1', name: 'Apple', unitPriceCents: 125, quantity: 1 }
  ])
  assert.equal(calculateSubtotalCents(cart), 125)
})

test('repeated scans increase the existing line and preserve its price snapshot', () => {
  const once = addProductToCart([], apple)
  const twice = addProductToCart(once, { ...apple, priceCents: 200 })

  assert.equal(twice.length, 1)
  assert.equal(twice[0]?.quantity, 2)
  assert.equal(twice[0]?.unitPriceCents, 125)
  assert.equal(calculateSubtotalCents(twice), 250)
})

test('unknown or inactive product lookup leaves the cart unchanged', () => {
  const cart = addProductToCart([], apple)

  assert.equal(addProductToCart(cart, null), cart)
})

test('quantity controls increase and decrease without dropping below one', () => {
  const cart = addProductToCart([], apple)
  const increased = changeCartQuantity(cart, apple.id, 1)
  const decreased = changeCartQuantity(increased, apple.id, -1)
  const minimum = changeCartQuantity(decreased, apple.id, -1)

  assert.equal(increased[0]?.quantity, 2)
  assert.equal(decreased[0]?.quantity, 1)
  assert.equal(minimum[0]?.quantity, 1)
})

test('remove and clear cart operations remove the expected lines', () => {
  const cart = addProductToCart(addProductToCart([], apple), juice)
  const remaining = removeCartProduct(cart, apple.id)

  assert.deepEqual(
    remaining.map((line) => line.productId),
    [juice.id]
  )
  assert.deepEqual(clearCart(cart), [])
})

test('subtotal uses integer cents across multiple products and quantities', () => {
  const cart = addProductToCart(addProductToCart([], apple), juice)
  const twoJuices = changeCartQuantity(cart, juice.id, 1)

  assert.equal(calculateSubtotalCents(twoJuices), 625)
})
