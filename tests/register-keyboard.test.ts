import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isTextEntryTarget,
  nextCartLineIndex,
  nextDirectionalFocusIndex,
  nextPaymentMethodIndex,
  resolveRegisterShortcut,
  shouldPreserveNativeArrow,
  shouldUnfocusSkuOnEscape
} from '../src/renderer/src/register-keyboard'

const availableRegister = {
  key: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  textEntryFocused: false,
  dialogOpen: false,
  skuEnabled: true,
  productsEnabled: true,
  customerPickerEnabled: true,
  clearEnabled: true,
  lineSelectionEnabled: true,
  priceEditEnabled: true,
  paymentEnabled: true,
  zeroTotalSaleEnabled: false,
  customItemEnabled: true
}

test('register shortcuts resolve to their assigned actions', () => {
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F2' }), 'focus-sku')
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'r' }), 'toggle-mode')
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'R' }), 'toggle-mode')
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F3' }), 'navigate-products')
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F8' }), 'open-customer-picker')
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F4' }), 'clear-cart')
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F5' }),
    'select-line-for-removal'
  )
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F6' }),
    'select-line-for-price'
  )
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F9' }), 'open-payment')
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F9', zeroTotalSaleEnabled: true }),
    'complete-zero-total-sale'
  )
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F10' }), 'open-custom-item')
})

test('mode shortcut stays out of text entry and all shortcuts stay out of dialogs', () => {
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'r', textEntryFocused: true }),
    null
  )
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'r', dialogOpen: true }), null)
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F9', dialogOpen: true }), null)
})

test('shortcuts respect modifiers, repeats, and unavailable actions', () => {
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'r', shiftKey: true }), null)
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F9', repeat: true }), null)
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F2', skuEnabled: false }),
    null
  )
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F3', productsEnabled: false }),
    null
  )
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F8', customerPickerEnabled: false }),
    null
  )
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F4', clearEnabled: false }),
    null
  )
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F5', lineSelectionEnabled: false }),
    null
  )
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F6', priceEditEnabled: false }),
    null
  )
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F9', paymentEnabled: false }),
    null
  )
  assert.equal(
    resolveRegisterShortcut({
      ...availableRegister,
      key: 'F9',
      paymentEnabled: false,
      zeroTotalSaleEnabled: false
    }),
    null
  )
  assert.equal(
    resolveRegisterShortcut({ ...availableRegister, key: 'F10', customItemEnabled: false }),
    null
  )
})

test('left and right arrows stay on the focused control’s visual row', () => {
  const rects = [
    { left: 0, top: 0, width: 40, height: 32 },
    { left: 100, top: 0, width: 40, height: 32 },
    { left: 30, top: 38, width: 40, height: 32 },
    { left: 60, top: 0, width: 40, height: 32 }
  ]

  assert.equal(nextDirectionalFocusIndex(0, rects, 'ArrowRight'), 3)
  assert.equal(nextDirectionalFocusIndex(0, rects, 'ArrowLeft'), null)
})

test('up and down arrows choose the nearest row, then the closest horizontal alignment', () => {
  const rects = [
    { left: 80, top: 0, width: 40, height: 32 },
    { left: 130, top: 54, width: 40, height: 32 },
    { left: 70, top: 54, width: 40, height: 32 },
    { left: 80, top: 104, width: 40, height: 32 }
  ]

  assert.equal(nextDirectionalFocusIndex(0, rects, 'ArrowDown'), 2)
  assert.equal(nextDirectionalFocusIndex(3, rects, 'ArrowUp'), 2)
})

test('directional focus does not jump diagonally when no control is on the same row', () => {
  const rects = [
    { left: 0, top: 0, width: 40, height: 32 },
    { left: 20, top: 38, width: 40, height: 32 }
  ]

  assert.equal(nextDirectionalFocusIndex(0, rects, 'ArrowRight'), null)
})

test('text-entry detection covers text inputs and editable descendants, not action buttons', () => {
  const target = (properties: Record<string, unknown>): EventTarget =>
    ({ tagName: 'INPUT', parentElement: null, ...properties }) as unknown as EventTarget

  assert.equal(isTextEntryTarget(target({ type: 'text' })), true)
  assert.equal(isTextEntryTarget(target({ tagName: 'TEXTAREA', type: undefined })), true)
  assert.equal(isTextEntryTarget(target({ type: 'checkbox' })), false)
  assert.equal(isTextEntryTarget(target({ type: 'button' })), false)
  assert.equal(isTextEntryTarget(target({ isContentEditable: true })), true)
})

test('arrow keys leave text fields at caret boundaries and keep editing within the text', () => {
  const textarea = (value: string, selectionStart: number, selectionEnd = selectionStart) =>
    ({
      tagName: 'TEXTAREA',
      value,
      selectionStart,
      selectionEnd,
      parentElement: null
    }) as unknown as EventTarget
  const input = (value: string, selectionStart: number, selectionEnd = selectionStart) =>
    ({
      tagName: 'INPUT',
      type: 'text',
      value,
      selectionStart,
      selectionEnd,
      parentElement: null
    }) as unknown as EventTarget

  const emptyTextarea = textarea('', 0)
  assert.equal(shouldPreserveNativeArrow('ArrowDown', emptyTextarea), false)
  assert.equal(shouldPreserveNativeArrow('ArrowUp', emptyTextarea), false)

  const multiline = textarea('First line\nSecond line', 3)
  assert.equal(shouldPreserveNativeArrow('ArrowDown', multiline), true)
  assert.equal(shouldPreserveNativeArrow('ArrowUp', multiline), false)
  assert.equal(
    shouldPreserveNativeArrow('ArrowDown', textarea('First line\nSecond line', 18)),
    false
  )
  assert.equal(shouldPreserveNativeArrow('ArrowRight', textarea('Address', 7)), false)
  assert.equal(shouldPreserveNativeArrow('ArrowLeft', textarea('Address', 3)), true)
  assert.equal(shouldPreserveNativeArrow('ArrowRight', textarea('Address', 1, 4)), true)

  assert.equal(shouldPreserveNativeArrow('ArrowLeft', input('Name', 0)), false)
  assert.equal(shouldPreserveNativeArrow('ArrowLeft', input('Name', 2)), true)
  assert.equal(shouldPreserveNativeArrow('ArrowRight', input('Name', 4)), false)
  assert.equal(shouldPreserveNativeArrow('ArrowRight', input('Name', 0)), true)
})

test('left and right arrows cycle through the payment methods', () => {
  assert.equal(nextPaymentMethodIndex(0, 'ArrowLeft', 3), 2)
  assert.equal(nextPaymentMethodIndex(0, 'ArrowRight', 3), 1)
  assert.equal(nextPaymentMethodIndex(2, 'ArrowRight', 3), 0)
  assert.equal(nextPaymentMethodIndex(1, 'ArrowUp', 3), null)
  assert.equal(nextPaymentMethodIndex(0, 'ArrowLeft', 0), null)
})

test('up and down select cart lines without moving past the list ends', () => {
  assert.equal(nextCartLineIndex(0, 'ArrowDown', 3), 1)
  assert.equal(nextCartLineIndex(1, 'ArrowUp', 3), 0)
  assert.equal(nextCartLineIndex(0, 'ArrowUp', 3), null)
  assert.equal(nextCartLineIndex(2, 'ArrowDown', 3), null)
  assert.equal(nextCartLineIndex(0, 'ArrowDown', 0), null)
  assert.equal(nextCartLineIndex(1, 'ArrowRight', 3), null)
})

test('Escape unfocuses SKU only when SKU has focus and no dialog is open', () => {
  assert.equal(shouldUnfocusSkuOnEscape('Escape', true, false), true)
  assert.equal(shouldUnfocusSkuOnEscape('Escape', true, true), false)
  assert.equal(shouldUnfocusSkuOnEscape('Escape', false, false), false)
  assert.equal(shouldUnfocusSkuOnEscape('Enter', true, false), false)
})
