import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Product } from '../src/shared/pos-api'
import {
  addCustomItemToCart,
  addProductToCart,
  cartLineKey,
  calculateSubtotalCents,
  changeCartQuantity,
  clearCart,
  overrideCartPrice,
  removeCartLine,
  toCheckoutItem,
  toReturnItem
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

test('custom items merge by normalized name and exact unit price, apart from catalog products', () => {
  const catalog = addProductToCart([], apple)
  const first = addCustomItemToCart(catalog, 'Photo Studio Shoot', 1250)
  const matching = addCustomItemToCart(first, ' photo studio shoot ', 1250)
  const differentName = addCustomItemToCart(matching, 'Print package', 1250)
  const differentPrice = addCustomItemToCart(differentName, 'Photo Studio Shoot', 1500)

  assert.equal(differentPrice.length, 4)
  assert.deepEqual(
    differentPrice.map(({ productId, name, unitPriceCents, quantity }) => [
      productId,
      name,
      unitPriceCents,
      quantity
    ]),
    [
      [apple.id, 'Apple', 125, 1],
      [null, 'Photo Studio Shoot', 1250, 2],
      [null, 'Print package', 1250, 1],
      [null, 'Photo Studio Shoot', 1500, 1]
    ]
  )
})

test('custom lines support cart editing and create non-restocking checkout and return inputs', () => {
  const cart = addCustomItemToCart([], 'Photo Studio Shoot', 1250)
  const key = cartLineKey(cart[0]!)
  const increased = changeCartQuantity(cart, key, 1)
  const overridden = overrideCartPrice(increased, key, 1000, 'Package discount')

  assert.equal(overridden[0]?.quantity, 2)
  assert.equal(calculateSubtotalCents(overridden), 2000)
  assert.deepEqual(toCheckoutItem(overridden[0]!), {
    customItem: { name: 'Photo Studio Shoot', unitPriceCents: 1250 },
    quantity: 2,
    priceOverride: { unitPriceCents: 1000, reason: 'Package discount' }
  })
  assert.deepEqual(toReturnItem(overridden[0]!), {
    customItem: { name: 'Photo Studio Shoot', unitPriceCents: 1250 },
    quantity: 2,
    restock: false
  })
  assert.deepEqual(removeCartLine(overridden, key), [])
})

test('transaction price overrides survive repeated scans and update the subtotal only in the cart', () => {
  const cart = addProductToCart([], apple)
  const overridden = overrideCartPrice(cart, cartLineKey(cart[0]!), 75, 'Damaged box')
  const scannedAgain = addProductToCart(overridden, { ...apple, priceCents: 250 })

  assert.equal(scannedAgain[0]?.quantity, 2)
  assert.deepEqual(scannedAgain[0]?.priceOverride, {
    unitPriceCents: 75,
    reason: 'Damaged box'
  })
  assert.equal(calculateSubtotalCents(scannedAgain), 150)
  assert.equal(apple.priceCents, 125)
})

test('unknown or inactive product lookup leaves the cart unchanged', () => {
  const cart = addProductToCart([], apple)

  assert.equal(addProductToCart(cart, null), cart)
})

test('quantity controls increase and decrease without dropping below one', () => {
  const cart = addProductToCart([], apple)
  const key = cartLineKey(cart[0]!)
  const increased = changeCartQuantity(cart, key, 1)
  const decreased = changeCartQuantity(increased, key, -1)
  const minimum = changeCartQuantity(decreased, key, -1)

  assert.equal(increased[0]?.quantity, 2)
  assert.equal(decreased[0]?.quantity, 1)
  assert.equal(minimum[0]?.quantity, 1)
})

test('remove and clear cart operations remove the expected lines', () => {
  const cart = addProductToCart(addProductToCart([], apple), juice)
  const remaining = removeCartLine(cart, cartLineKey(cart[0]!))

  assert.deepEqual(
    remaining.map((line) => line.productId),
    [juice.id]
  )
  assert.deepEqual(clearCart(cart), [])
})

test('subtotal uses integer cents across multiple products and quantities', () => {
  const cart = addProductToCart(addProductToCart([], apple), juice)
  const twoJuices = changeCartQuantity(cart, cartLineKey(cart[1]!), 1)

  assert.equal(calculateSubtotalCents(twoJuices), 625)
})
