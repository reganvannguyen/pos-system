import type { PriceOverrideInput, Product } from '../../shared/pos-api'

export interface CartLine {
  productId: number
  sku: string
  name: string
  unitPriceCents: number
  quantity: number
  priceOverride?: PriceOverrideInput
  restock?: boolean
}

export function addProductToCart(cart: CartLine[], product: Product | null): CartLine[] {
  if (!product) return cart

  const existing = cart.find((line) => line.productId === product.id)
  if (existing) {
    return cart.map((line) =>
      line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line
    )
  }

  return [
    ...cart,
    {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      unitPriceCents: product.priceCents,
      quantity: 1
    }
  ]
}

export function changeCartQuantity(
  cart: CartLine[],
  productId: number,
  change: -1 | 1
): CartLine[] {
  return cart.map((line) => {
    if (line.productId !== productId) return line
    const quantity = Math.max(1, line.quantity + change)
    return quantity === line.quantity ? line : { ...line, quantity }
  })
}

export function overrideCartPrice(
  cart: CartLine[],
  productId: number,
  unitPriceCents: number,
  reason: string
): CartLine[] {
  return cart.map((line) =>
    line.productId === productId
      ? { ...line, priceOverride: { unitPriceCents, reason: reason.trim() } }
      : line
  )
}

export function removeCartProduct(cart: CartLine[], productId: number): CartLine[] {
  return cart.filter((line) => line.productId !== productId)
}

export function clearCart(cart: CartLine[]): CartLine[] {
  return cart.length > 0 ? [] : cart
}

export function calculateSubtotalCents(cart: CartLine[]): number {
  return cart.reduce(
    (subtotal, line) =>
      subtotal + (line.priceOverride?.unitPriceCents ?? line.unitPriceCents) * line.quantity,
    0
  )
}
