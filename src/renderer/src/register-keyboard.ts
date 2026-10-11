export type RegisterShortcutAction =
  | 'focus-sku'
  | 'toggle-mode'
  | 'navigate-products'
  | 'clear-cart'
  | 'select-line-for-removal'
  | 'select-line-for-price'
  | 'open-payment'

export interface RegisterShortcutContext {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  repeat: boolean
  textEntryFocused: boolean
  dialogOpen: boolean
  skuEnabled: boolean
  productsEnabled: boolean
  clearEnabled: boolean
  lineSelectionEnabled: boolean
  priceEditEnabled: boolean
  paymentEnabled: boolean
}

export interface FocusRect {
  left: number
  top: number
  width: number
  height: number
}

export function resolveRegisterShortcut(
  context: RegisterShortcutContext
): RegisterShortcutAction | null {
  if (
    context.altKey ||
    context.ctrlKey ||
    context.metaKey ||
    context.shiftKey ||
    context.repeat ||
    context.dialogOpen
  ) {
    return null
  }

  if (context.key === 'F2') return context.skuEnabled ? 'focus-sku' : null
  if (context.key === 'F3') return context.productsEnabled ? 'navigate-products' : null
  if (context.key === 'F4') return context.clearEnabled ? 'clear-cart' : null
  if (context.key === 'F5') return context.lineSelectionEnabled ? 'select-line-for-removal' : null
  if (context.key === 'F6') return context.priceEditEnabled ? 'select-line-for-price' : null
  if (context.key === 'F9') return context.paymentEnabled ? 'open-payment' : null
  if (context.key.toLowerCase() === 'r' && !context.textEntryFocused) return 'toggle-mode'
  return null
}

export function nextCartLineIndex(
  currentIndex: number,
  key: string,
  lineCount: number
): number | null {
  if (lineCount <= 0 || (key !== 'ArrowUp' && key !== 'ArrowDown')) return null

  if (key === 'ArrowUp') return currentIndex > 0 ? currentIndex - 1 : null
  return currentIndex < lineCount - 1 ? currentIndex + 1 : null
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  let element = target as HTMLElement | null

  while (element && typeof element.tagName === 'string') {
    if (element.isContentEditable) return true

    const tagName = element.tagName.toUpperCase()
    if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true
    if (tagName === 'INPUT') {
      const inputType = (element as HTMLInputElement).type.toLowerCase()
      return ![
        'button',
        'checkbox',
        'color',
        'file',
        'hidden',
        'image',
        'radio',
        'range',
        'reset',
        'submit'
      ].includes(inputType)
    }

    element = element.parentElement
  }

  return false
}

export function nextPaymentMethodIndex(
  currentIndex: number,
  key: string,
  optionCount: number
): number | null {
  if (optionCount <= 0 || (key !== 'ArrowLeft' && key !== 'ArrowRight')) return null

  if (currentIndex < 0 || currentIndex >= optionCount) {
    return key === 'ArrowRight' ? 0 : optionCount - 1
  }

  const direction = key === 'ArrowRight' ? 1 : -1
  return (currentIndex + direction + optionCount) % optionCount
}

export function resolvePaymentMethodShortcut<T extends string>(
  key: string,
  methods: readonly T[]
): T | null {
  const shortcuts: Record<string, string> = {
    '1': 'cash',
    '2': 'credit',
    '3': 'charge',
    '4': 'debit'
  }
  const method = shortcuts[key]
  return method && methods.includes(method as T) ? (method as T) : null
}

export function nextDirectionalFocusIndex(
  currentIndex: number,
  rects: readonly FocusRect[],
  key: string
): number | null {
  if (
    currentIndex < 0 ||
    currentIndex >= rects.length ||
    !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)
  ) {
    return null
  }

  const current = rects[currentIndex]!
  const currentX = current.left + current.width / 2
  const currentY = current.top + current.height / 2
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
  const forward = key === 'ArrowRight' || key === 'ArrowDown'
  let bestIndex: number | null = null
  let bestScore = Number.POSITIVE_INFINITY

  rects.forEach((rect, index) => {
    if (index === currentIndex) return

    const deltaX = rect.left + rect.width / 2 - currentX
    const deltaY = rect.top + rect.height / 2 - currentY
    const primary = horizontal ? deltaX : deltaY
    const secondary = horizontal ? deltaY : deltaX
    if ((forward && primary <= 1) || (!forward && primary >= -1)) return

    const score = Math.abs(primary) + Math.abs(secondary) * 1.5
    if (score < bestScore) {
      bestScore = score
      bestIndex = index
    }
  })

  return bestIndex
}

export function shouldPreserveNativeArrow(key: string, target: EventTarget | null): boolean {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return false

  let element = target as HTMLElement | null
  while (element && typeof element.tagName === 'string') {
    if (element.isContentEditable) return true

    const tagName = element.tagName.toUpperCase()
    if (tagName === 'SELECT') return true
    if (tagName === 'TEXTAREA') {
      const textarea = element as HTMLTextAreaElement
      const selectionStart = textarea.selectionStart
      const selectionEnd = textarea.selectionEnd
      if (selectionStart !== selectionEnd) return true

      if (key === 'ArrowLeft') return selectionStart > 0
      if (key === 'ArrowRight') return selectionEnd < textarea.value.length
      if (key === 'ArrowUp') return textarea.value.slice(0, selectionStart).includes('\n')
      return textarea.value.slice(selectionEnd).includes('\n')
    }
    if (tagName === 'INPUT') {
      const input = element as HTMLInputElement
      const inputType = input.type.toLowerCase()
      if (
        ['number', 'date', 'datetime-local', 'month', 'range', 'time', 'week'].includes(inputType)
      ) {
        return true
      }
      if (!['text', 'search', 'url', 'tel', 'email', 'password'].includes(inputType)) return false

      const selectionStart = input.selectionStart
      const selectionEnd = input.selectionEnd
      if (selectionStart === null || selectionEnd === null) return true
      if (selectionStart !== selectionEnd) return true
      if (key === 'ArrowLeft') return selectionStart > 0
      if (key === 'ArrowRight') return selectionEnd < input.value.length
      return false
    }

    element = element.parentElement
  }

  return false
}

export function shouldUnfocusSkuOnEscape(
  key: string,
  skuFocused: boolean,
  dialogOpen: boolean
): boolean {
  return key === 'Escape' && skuFocused && !dialogOpen
}
