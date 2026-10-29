import type {
  CheckoutItem,
  PriceOverrideInput,
  Product,
  ReturnItemInput
} from '../../shared/pos-api'

export interface CartLine {
  productId: number | null
  sku: string
  name: string
  unitPriceCents: number
  quantity: number
  priceOverride?: PriceOverrideInput
  restock?: boolean
}

export function cartLineKey(line: CartLine): string {
  return line.productId === null
    ? `custom:${JSON.stringify([normalizeCustomName(line.name), line.unitPriceCents])}`
    : `product:${line.productId}`
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

export function addCustomItemToCart(
  cart: CartLine[],
  name: string,
  unitPriceCents: number
): CartLine[] {
  const trimmedName = name.trim()
  const normalizedName = normalizeCustomName(trimmedName)
  const existing = cart.find(
    (line) =>
      line.productId === null &&
      normalizeCustomName(line.name) === normalizedName &&
      line.unitPriceCents === unitPriceCents
  )
  if (existing) {
    const existingKey = cartLineKey(existing)
    return cart.map((line) =>
      cartLineKey(line) === existingKey ? { ...line, quantity: line.quantity + 1 } : line
    )
  }

  return [
    ...cart,
    {
      productId: null,
      sku: '',
      name: trimmedName,
      unitPriceCents,
      quantity: 1,
      restock: false
    }
  ]
}

export function changeCartQuantity(cart: CartLine[], lineKey: string, change: -1 | 1): CartLine[] {
  return cart.map((line) => {
    if (cartLineKey(line) !== lineKey) return line
    const quantity = Math.max(1, line.quantity + change)
    return quantity === line.quantity ? line : { ...line, quantity }
  })
}

export function overrideCartPrice(
  cart: CartLine[],
  lineKey: string,
  unitPriceCents: number,
  reason: string
): CartLine[] {
  return cart.map((line) =>
    cartLineKey(line) === lineKey
      ? { ...line, priceOverride: { unitPriceCents, reason: reason.trim() } }
      : line
  )
}

export function removeCartLine(cart: CartLine[], lineKey: string): CartLine[] {
  return cart.filter((line) => cartLineKey(line) !== lineKey)
}

export function clearCart(cart: CartLine[]): CartLine[] {
  return cart.length > 0 ? [] : cart
}

export function toCheckoutItem(line: CartLine): CheckoutItem {
  const priceOverride = line.priceOverride
  return line.productId === null
    ? {
        customItem: { name: line.name, unitPriceCents: line.unitPriceCents },
        quantity: line.quantity,
        ...(priceOverride && { priceOverride })
      }
    : {
        productId: line.productId,
        quantity: line.quantity,
        ...(priceOverride && { priceOverride })
      }
}

export function toReturnItem(line: CartLine): ReturnItemInput {
  return line.productId === null
    ? {
        customItem: { name: line.name, unitPriceCents: line.unitPriceCents },
        quantity: line.quantity,
        restock: false
      }
    : {
        productId: line.productId,
        quantity: line.quantity,
        restock: line.restock ?? false
      }
}

export function calculateSubtotalCents(cart: CartLine[]): number {
  return cart.reduce(
    (subtotal, line) =>
      subtotal + (line.priceOverride?.unitPriceCents ?? line.unitPriceCents) * line.quantity,
    0
  )
}

function normalizeCustomName(name: string): string {
  return name.trim().toLocaleLowerCase('en-CA')
}
