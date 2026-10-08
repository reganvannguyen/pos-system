import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isTextEntryTarget,
  nextCartLineIndex,
  nextPaymentMethodIndex,
  resolveRegisterShortcut,
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
  clearEnabled: true,
  lineSelectionEnabled: true,
  priceEditEnabled: true,
  paymentEnabled: true
}

test('register shortcuts resolve to their assigned actions', () => {
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F2' }), 'focus-sku')
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'r' }), 'toggle-mode')
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'R' }), 'toggle-mode')
  assert.equal(resolveRegisterShortcut({ ...availableRegister, key: 'F3' }), 'navigate-products')
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
