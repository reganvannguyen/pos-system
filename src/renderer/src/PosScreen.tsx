import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type {
  CheckoutQuote,
  Customer,
  ReturnQuote,
  SaleDetail,
  TenderInput,
  TenderType
} from '../../shared/pos-api'
import ReceiptDialog from './ReceiptDialog'
import { CustomerLookupDialog } from './CustomersScreen'
import {
  addProductToCart,
  changeCartQuantity,
  clearCart,
  overrideCartPrice,
  removeCartProduct,
  type CartLine
} from './cart'
import {
  allocateReturnPayouts,
  allocateTenders,
  centsInput,
  parseCadCents,
  tenderLabel,
  totalTenderedCents,
  type CheckoutSession
} from './checkout'
import {
  isTextEntryTarget,
  nextCartLineIndex,
  nextDirectionalFocusIndex,
  nextPaymentMethodIndex,
  resolvePaymentMethodShortcut,
  resolveRegisterShortcut,
  shouldPreserveNativeArrow,
  shouldUnfocusSkuOnEscape
} from './register-keyboard'

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
})
const emptyTenders: TenderInput[] = []

function customerName(customer: Customer): string {
  return [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.companyName
}

interface PosScreenProps {
  cart: CartLine[]
  setCart: Dispatch<SetStateAction<CartLine[]>>
  checkoutSession: CheckoutSession | null
  setCheckoutSession: Dispatch<SetStateAction<CheckoutSession | null>>
  mode: 'sale' | 'return'
  setMode: Dispatch<SetStateAction<'sale' | 'return'>>
  returnReason: string
  setReturnReason: Dispatch<SetStateAction<string>>
  selectedCustomer: Customer | null
  setSelectedCustomer: Dispatch<SetStateAction<Customer | null>>
  onNavigateToProducts: () => void
}

interface QuoteState {
  cart: CartLine[]
  mode: 'sale' | 'return'
  returnReason: string
  retryKey: number
  quote?: CheckoutQuote | ReturnQuote
  error?: string
}

type QuoteItem = CheckoutQuote['items'][number]

function PosScreen({
  cart,
  setCart,
  checkoutSession,
  setCheckoutSession,
  mode,
  setMode,
  returnReason,
  setReturnReason,
  selectedCustomer,
  setSelectedCustomer,
  onNavigateToProducts
}: PosScreenProps): React.JSX.Element {
  const [skuInput, setSkuInput] = useState('')
  const [lookupMessage, setLookupMessage] = useState('')
  const [lookupIsError, setLookupIsError] = useState(false)
  const [pendingLookups, setPendingLookups] = useState(0)
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null)
  const [quoteRetryKey, setQuoteRetryKey] = useState(0)
  const [paymentMethodPickerOpen, setPaymentMethodPickerOpen] = useState(false)
  const [customerLookupOpen, setCustomerLookupOpen] = useState(false)
  const [chargeSelectionPending, setChargeSelectionPending] = useState(false)
  const [tenderDialogType, setTenderDialogType] = useState<TenderType | null>(null)
  const [paymentActive, setPaymentActive] = useState(false)
  const [priceDialogLine, setPriceDialogLine] = useState<QuoteItem | null>(null)
  const [lineSelectionMode, setLineSelectionMode] = useState<'remove' | 'price' | null>(null)
  const [selectedCartLineIndex, setSelectedCartLineIndex] = useState<number | null>(null)
  const [confirmTransaction, setConfirmTransaction] = useState(false)
  const [savingSale, setSavingSale] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [completedSale, setCompletedSale] = useState<SaleDetail | null>(null)
  const [receiptDialogSale, setReceiptDialogSale] = useState<SaleDetail | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const registerRef = useRef<HTMLElement>(null)
  const clearCartButtonRef = useRef<HTMLButtonElement>(null)
  const cartLineRowRefs = useRef(new Map<number, HTMLTableRowElement>())
  const addPaymentButtonRef = useRef<HTMLButtonElement>(null)
  const completeTransactionButtonRef = useRef<HTMLButtonElement>(null)
  const lookupQueue = useRef<Promise<void>>(Promise.resolve())
  const previousCartLength = useRef(cart.length)
  const itemCount = cart.reduce((count, line) => count + line.quantity, 0)
  const quoteMatchesCurrentCart =
    quoteState?.cart === cart &&
    quoteState.mode === mode &&
    quoteState.returnReason === returnReason &&
    quoteState.retryKey === quoteRetryKey
  const quote = quoteMatchesCurrentCart ? (quoteState.quote ?? null) : null
  const returnReasonMissing = mode === 'return' && cart.length > 0 && !returnReason.trim()
  const quoteError = quoteMatchesCurrentCart
    ? (quoteState.error ?? '')
    : returnReasonMissing
      ? 'Enter a reason for this return before calculating its refund.'
      : ''
  const quoteLoading = cart.length > 0 && !quoteMatchesCurrentCart && !returnReasonMissing
  const displayLines = quote?.items ?? cart
  const tenders = checkoutSession?.tenders ?? emptyTenders
  const chargeRemainingBalance = checkoutSession?.chargeRemainingBalance === true
  const selectedCartLine =
    selectedCartLineIndex === null ? null : (cart[selectedCartLineIndex] ?? null)
  const paymentTargetCents = quote ? Math.abs(quote.totalCents) : 0
  const tenderSummary = useMemo(() => {
    if (!quote) return null
    return mode === 'return'
      ? allocateReturnPayouts(paymentTargetCents, tenders)
      : allocateTenders(paymentTargetCents, tenders)
  }, [mode, paymentTargetCents, quote, tenders])
  const tenderSummaryInvalid = tenderSummary?.valid === false
  const tenderRemainingCents = tenderSummary?.remainingCents
  const hasStagedCharge = chargeRemainingBalance
  const hasCheckoutSession = checkoutSession !== null
  const hasPriceDialogLine = priceDialogLine !== null
  const chargeAmountCents = chargeRemainingBalance ? (tenderSummary?.remainingCents ?? 0) : 0
  const sessionNeedsResume = checkoutSession !== null && !paymentActive
  const cartLocked =
    savingSale || checkoutSession !== null || paymentActive || lineSelectionMode !== null
  const checkoutDisabled =
    !quote || quoteLoading || pendingLookups > 0 || savingSale || lineSelectionMode !== null
  const focusCartLineAtIndex = useCallback(
    (index: number): void => {
      const productId = cart[index]?.productId
      if (productId === undefined) return
      window.requestAnimationFrame(() => cartLineRowRefs.current.get(productId)?.focus())
    },
    [cart]
  )
  const startLineSelection = useCallback(
    (selectionMode: 'remove' | 'price'): void => {
      if (!cart.length || cartLocked || pendingLookups > 0) return
      if (selectionMode === 'price' && (mode !== 'sale' || !quote)) return
      setLineSelectionMode(selectionMode)
      setSelectedCartLineIndex(0)
      focusCartLineAtIndex(0)
    },
    [cart.length, cartLocked, focusCartLineAtIndex, mode, pendingLookups, quote]
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (previousCartLength.current > 0 && cart.length === 0) setSelectedCustomer(null)
    previousCartLength.current = cart.length
  }, [cart.length, setSelectedCustomer])

  useEffect(() => {
    let current = true
    if (cart.length === 0) {
      return
    }
    if (mode === 'return' && !returnReason.trim()) {
      return
    }
    const operation =
      mode === 'return'
        ? window.pos.sales.quoteReturn({
            reason: returnReason,
            items: cart.map(({ productId, quantity, restock }) => ({
              productId,
              quantity,
              restock: restock ?? false
            }))
          })
        : window.pos.sales.quote(
            cart.map(({ productId, quantity, priceOverride }) => ({
              productId,
              quantity,
              ...(priceOverride && { priceOverride })
            }))
          )
    void operation
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setQuoteState({ cart, mode, returnReason, retryKey: quoteRetryKey, quote: result.data })
        } else {
          setQuoteState({
            cart,
            mode,
            returnReason,
            retryKey: quoteRetryKey,
            error: result.error.message
          })
        }
      })
      .catch(() => {
        if (current) {
          setQuoteState({
            cart,
            mode,
            returnReason,
            retryKey: quoteRetryKey,
            error: `${mode === 'return' ? 'Return' : 'Sale'} totals could not be calculated. Try again.`
          })
        }
      })

    return () => {
      current = false
    }
  }, [cart, mode, quoteRetryKey, returnReason])

  useEffect(() => {
    if (
      !paymentMethodPickerOpen &&
      !customerLookupOpen &&
      !tenderDialogType &&
      !priceDialogLine &&
      !confirmTransaction &&
      !receiptDialogSale &&
      !paymentActive &&
      !savingSale
    ) {
      inputRef.current?.focus()
    }
  }, [
    paymentMethodPickerOpen,
    customerLookupOpen,
    tenderDialogType,
    priceDialogLine,
    confirmTransaction,
    receiptDialogSale,
    paymentActive,
    savingSale
  ])

  const beginTender = useCallback(
    (type: TenderType): void => {
      if (
        checkoutDisabled ||
        hasStagedCharge ||
        tenderSummaryInvalid ||
        tenderRemainingCents === 0 ||
        tenderDialogType ||
        hasPriceDialogLine ||
        confirmTransaction
      )
        return
      setCheckoutError('')
      setPaymentActive(true)
      setTenderDialogType(type)
    },
    [
      checkoutDisabled,
      hasStagedCharge,
      tenderSummaryInvalid,
      tenderRemainingCents,
      confirmTransaction,
      hasPriceDialogLine,
      tenderDialogType
    ]
  )

  const openTenderPicker = useCallback((): void => {
    if (
      checkoutDisabled ||
      hasStagedCharge ||
      tenderSummaryInvalid ||
      tenderRemainingCents === 0 ||
      paymentMethodPickerOpen ||
      tenderDialogType ||
      hasPriceDialogLine ||
      confirmTransaction
    )
      return
    setCheckoutError('')
    if (hasCheckoutSession && !paymentActive) setPaymentActive(true)
    setPaymentMethodPickerOpen(true)
  }, [
    checkoutDisabled,
    hasStagedCharge,
    hasCheckoutSession,
    tenderSummaryInvalid,
    tenderRemainingCents,
    confirmTransaction,
    paymentActive,
    paymentMethodPickerOpen,
    hasPriceDialogLine,
    tenderDialogType
  ])

  function beginChargeEntry(): void {
    if (mode !== 'sale' || checkoutDisabled || tenderSummary?.valid === false) return
    if (tenderSummary?.remainingCents === 0 || confirmTransaction || priceDialogLine) return
    setCheckoutError('')
    setPaymentActive(true)
    if (selectedCustomer) {
      stageCharge(selectedCustomer)
    } else {
      setChargeSelectionPending(true)
      setCustomerLookupOpen(true)
    }
  }

  const changeRegisterMode = useCallback(
    (nextMode: 'sale' | 'return'): void => {
      if (nextMode === mode || pendingLookups > 0) return
      if (
        (cart.length > 0 || (checkoutSession?.tenders.length ?? 0) > 0) &&
        !window.confirm(
          `Switch to ${nextMode === 'return' ? 'Return' : 'Sale'} mode and clear the current cart and staged payments?`
        )
      ) {
        return
      }
      setCart([])
      setCheckoutSession(null)
      setPaymentActive(false)
      setTenderDialogType(null)
      setPaymentMethodPickerOpen(false)
      setCustomerLookupOpen(false)
      setChargeSelectionPending(false)
      setPriceDialogLine(null)
      setConfirmTransaction(false)
      setReturnReason('')
      setQuoteState(null)
      setQuoteRetryKey((key) => key + 1)
      setCheckoutError('')
      setCompletedSale(null)
      setReceiptDialogSale(null)
      setSelectedCustomer(null)
      setMode(nextMode)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    },
    [
      cart.length,
      checkoutSession,
      mode,
      pendingLookups,
      setCart,
      setCheckoutSession,
      setMode,
      setReturnReason,
      setSelectedCustomer
    ]
  )

  useEffect(() => {
    function navigateWithArrow(event: KeyboardEvent): void {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.repeat ||
        shouldPreserveNativeArrow(event.key, event.target)
      ) {
        return
      }

      const openDialog = document.querySelector<HTMLDialogElement>('dialog[open]')
      const scope: ParentNode | null = openDialog ?? registerRef.current
      if (!scope) return

      const candidates = Array.from(
        scope.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
      const currentIndex = candidates.indexOf(document.activeElement as HTMLElement)
      const nextIndex = nextDirectionalFocusIndex(
        currentIndex,
        candidates.map((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }),
        event.key
      )

      if (nextIndex === null) return
      event.preventDefault()
      candidates[nextIndex]?.focus()
    }

    function handlePosShortcut(event: KeyboardEvent): void {
      const hasNoModifiers = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      const reservedFunctionKey = ['F2', 'F3', 'F4', 'F5', 'F6', 'F8', 'F9'].includes(event.key)
      if (hasNoModifiers && reservedFunctionKey) event.preventDefault()

      if (lineSelectionMode !== null && hasNoModifiers) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setLineSelectionMode(null)
          setSelectedCartLineIndex(null)
          window.requestAnimationFrame(() => inputRef.current?.focus())
          return
        }

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          if (event.repeat) return
          const nextIndex = nextCartLineIndex(selectedCartLineIndex ?? 0, event.key, cart.length)
          if (nextIndex !== null) {
            setSelectedCartLineIndex(nextIndex)
            focusCartLineAtIndex(nextIndex)
          }
          return
        }

        if (event.key === 'Enter') {
          event.preventDefault()
          if (event.repeat) return
          const selectedLine =
            selectedCartLineIndex === null ? undefined : cart[selectedCartLineIndex]
          if (!selectedLine) return

          if (lineSelectionMode === 'remove') {
            setCart((current) => removeCartProduct(current, selectedLine.productId))
            setLookupMessage(
              `${selectedLine.name} removed from the ${mode === 'return' ? 'return' : 'sale'}.`
            )
            setLookupIsError(false)
            setCompletedSale(null)
            setReceiptDialogSale(null)
            setCheckoutError('')
            setLineSelectionMode(null)
            setSelectedCartLineIndex(null)
            window.requestAnimationFrame(() => inputRef.current?.focus())
          } else {
            const quotedLine = displayLines[selectedCartLineIndex ?? 0]
            if (mode === 'sale' && quotedLine) {
              setPriceDialogLine(quotedLine as QuoteItem)
              setLineSelectionMode(null)
              setSelectedCartLineIndex(null)
            }
          }
          return
        }
      }

      const dialogOpen =
        document.querySelector('dialog[open]') !== null ||
        customerLookupOpen ||
        paymentMethodPickerOpen ||
        tenderDialogType !== null ||
        priceDialogLine !== null ||
        confirmTransaction ||
        receiptDialogSale !== null ||
        lineSelectionMode !== null

      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.repeat &&
        shouldUnfocusSkuOnEscape(event.key, document.activeElement === inputRef.current, dialogOpen)
      ) {
        event.preventDefault()
        inputRef.current?.blur()
        return
      }

      navigateWithArrow(event)

      const action = resolveRegisterShortcut({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
        textEntryFocused: isTextEntryTarget(event.target),
        dialogOpen,
        skuEnabled: !cartLocked,
        productsEnabled: pendingLookups === 0 && !savingSale,
        customerPickerEnabled:
          pendingLookups === 0 && !savingSale && !paymentActive && lineSelectionMode === null,
        clearEnabled: cart.length > 0 && !cartLocked && pendingLookups === 0,
        lineSelectionEnabled: cart.length > 0 && !cartLocked && pendingLookups === 0,
        priceEditEnabled:
          cart.length > 0 &&
          !cartLocked &&
          pendingLookups === 0 &&
          mode === 'sale' &&
          quote !== null,
        paymentEnabled:
          !checkoutDisabled && tenderSummary?.valid !== false && tenderSummary?.remainingCents !== 0
      })

      if (!action) return
      event.preventDefault()

      if (action === 'focus-sku') {
        inputRef.current?.focus()
      } else if (action === 'toggle-mode') {
        changeRegisterMode(mode === 'sale' ? 'return' : 'sale')
      } else if (action === 'navigate-products') {
        onNavigateToProducts()
      } else if (action === 'open-customer-picker') {
        setCustomerLookupOpen(true)
      } else if (action === 'clear-cart') {
        clearCartButtonRef.current?.click()
      } else if (action === 'select-line-for-removal') {
        startLineSelection('remove')
      } else if (action === 'select-line-for-price') {
        startLineSelection('price')
      } else if (action === 'open-payment') {
        openTenderPicker()
      }
    }

    window.addEventListener('keydown', handlePosShortcut)
    return () => window.removeEventListener('keydown', handlePosShortcut)
  }, [
    cartLocked,
    cart,
    changeRegisterMode,
    checkoutDisabled,
    displayLines,
    customerLookupOpen,
    focusCartLineAtIndex,
    lineSelectionMode,
    mode,
    onNavigateToProducts,
    openTenderPicker,
    pendingLookups,
    paymentActive,
    paymentMethodPickerOpen,
    priceDialogLine,
    quote,
    confirmTransaction,
    receiptDialogSale,
    savingSale,
    selectedCartLineIndex,
    setCustomerLookupOpen,
    setCart,
    setSelectedCustomer,
    startLineSelection,
    tenderDialogType,
    tenderSummary
  ])

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (cartLocked) return
    const sku = skuInput.trim()
    setSkuInput('')
    setLookupMessage('')
    setLookupIsError(false)
    setCompletedSale(null)
    setReceiptDialogSale(null)
    inputRef.current?.focus()

    if (!sku) return

    setPendingLookups((count) => count + 1)
    lookupQueue.current = lookupQueue.current.then(async () => {
      try {
        const result =
          mode === 'return'
            ? await window.pos.products.getBySkuForReturn(sku)
            : await window.pos.products.getBySku(sku)
        if (!result.ok) {
          setLookupMessage(result.error.message)
          setLookupIsError(true)
        } else if (!result.data) {
          setLookupMessage(`Product not found: ${sku}`)
          setLookupIsError(true)
        } else {
          setCart((current) => addProductToCart(current, result.data))
          setLookupMessage(`${result.data.name} added to ${mode === 'return' ? 'return' : 'sale'}.`)
          setLookupIsError(false)
        }
      } catch {
        setLookupMessage('Product lookup failed. Try scanning the SKU again.')
        setLookupIsError(true)
      } finally {
        setPendingLookups((count) => Math.max(0, count - 1))
        inputRef.current?.focus()
      }
    })
  }

  function handleClearCart(): void {
    if (cart.length === 0 || cartLocked) return
    const itemLabel = itemCount === 1 ? 'item' : 'items'
    if (!window.confirm(`Clear all ${itemCount} ${itemLabel} from the cart?`)) return
    setCart((current) => clearCart(current))
    setLookupMessage('Cart cleared.')
    setLookupIsError(false)
    setCheckoutError('')
    setCompletedSale(null)
    setReceiptDialogSale(null)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  function stageTender(tender: TenderInput): string | null {
    if (!quote) return `${mode === 'return' ? 'Return' : 'Sale'} totals are still loading.`
    const nextTenders = [...tenders, tender]
    const nextSummary =
      mode === 'return'
        ? allocateReturnPayouts(Math.abs(quote.totalCents), nextTenders)
        : allocateTenders(quote.totalCents, nextTenders)
    if (!nextSummary.valid) return nextSummary.error
    const balanceWasOpen = (tenderSummary?.remainingCents ?? paymentTargetCents) > 0
    setCheckoutSession({ tenders: nextTenders })
    setPaymentActive(true)
    setTenderDialogType(null)
    setCheckoutError('')
    if (balanceWasOpen && nextSummary.remainingCents === 0) {
      setConfirmTransaction(true)
    } else if (nextSummary.remainingCents > 0) {
      window.requestAnimationFrame(() => addPaymentButtonRef.current?.focus())
    }
    return null
  }

  function stageCharge(customer: Customer): string | null {
    const remainingCents = tenderSummary?.remainingCents
    if (!quote || mode !== 'sale' || remainingCents === undefined || remainingCents <= 0) {
      return 'There is no remaining balance to charge.'
    }
    if (!tenderSummary?.valid) return tenderSummary?.error || 'Correct the staged payments first.'
    setSelectedCustomer(customer)
    setCheckoutSession({ tenders, chargeRemainingBalance: true })
    setPaymentActive(true)
    setCustomerLookupOpen(false)
    setChargeSelectionPending(false)
    setCheckoutError('')
    setConfirmTransaction(true)
    return null
  }

  function cancelTenderPicker(): void {
    setPaymentMethodPickerOpen(false)
    window.requestAnimationFrame(() => addPaymentButtonRef.current?.focus())
  }

  function cancelTenderEntry(): void {
    setTenderDialogType(null)
    if (!checkoutSession) setPaymentActive(false)
    window.requestAnimationFrame(() => addPaymentButtonRef.current?.focus())
  }

  function cancelChargeEntry(): void {
    setCustomerLookupOpen(false)
    setChargeSelectionPending(false)
    if (!checkoutSession) setPaymentActive(false)
    window.requestAnimationFrame(() => addPaymentButtonRef.current?.focus())
  }

  function handleCustomerSelected(customer: Customer | null): void {
    setSelectedCustomer(customer)
    setCustomerLookupOpen(false)
    if (chargeSelectionPending) {
      setChargeSelectionPending(false)
      if (customer) stageCharge(customer)
      else cancelChargeEntry()
      return
    }
    if (!customer && chargeRemainingBalance) {
      setCheckoutSession(tenders.length > 0 ? { tenders } : null)
      setPaymentActive(false)
      setConfirmTransaction(false)
    }
  }

  function cancelCustomerLookup(): void {
    if (chargeSelectionPending) cancelChargeEntry()
    else setCustomerLookupOpen(false)
  }

  function cancelTransactionConfirmation(): void {
    setConfirmTransaction(false)
    window.requestAnimationFrame(() => completeTransactionButtonRef.current?.focus())
  }

  function removeTender(index: number): void {
    const nextTenders = tenders.filter((_, tenderIndex) => tenderIndex !== index)
    setCheckoutSession(
      chargeRemainingBalance
        ? { tenders: nextTenders, chargeRemainingBalance: true }
        : nextTenders.length > 0
          ? { tenders: nextTenders }
          : null
    )
    setCheckoutError('')
    const nextSummary = quote
      ? mode === 'return'
        ? allocateReturnPayouts(Math.abs(quote.totalCents), nextTenders)
        : allocateTenders(quote.totalCents, nextTenders)
      : null
    window.requestAnimationFrame(() => {
      if (nextSummary?.valid && nextSummary.remainingCents === 0) {
        completeTransactionButtonRef.current?.focus()
      } else {
        addPaymentButtonRef.current?.focus()
      }
    })
  }

  function discardPaymentSession(): void {
    if (
      (tenders.length > 0 || chargeRemainingBalance) &&
      !window.confirm('Discard all staged payments? The cart will remain.')
    ) {
      return
    }
    setCheckoutSession(null)
    setTenderDialogType(null)
    setPaymentActive(false)
    setCheckoutError('')
    window.requestAnimationFrame(() => addPaymentButtonRef.current?.focus())
  }

  function resumePayment(): void {
    setPaymentActive(true)
    if (checkoutSession?.chargeRemainingBalance) setConfirmTransaction(true)
    window.requestAnimationFrame(() => addPaymentButtonRef.current?.focus())
  }

  function applyPriceOverride(priceCents: number, reason: string): void {
    if (!priceDialogLine || cartLocked) return
    setCart((current) => overrideCartPrice(current, priceDialogLine.productId, priceCents, reason))
    setPriceDialogLine(null)
    setLookupMessage(`Price updated for ${priceDialogLine.name} in this sale.`)
    setLookupIsError(false)
    setCompletedSale(null)
  }

  async function completeTransaction(): Promise<void> {
    const hasCharge = mode === 'sale' && chargeRemainingBalance
    if (
      !quote ||
      !tenderSummary?.valid ||
      (tenderSummary.remainingCents !== 0 && !hasCharge) ||
      savingSale
    )
      return
    setSavingSale(true)
    setCheckoutError('')

    try {
      let transaction: SaleDetail
      if (mode === 'return') {
        const result = await window.pos.sales.completeReturn({
          items: cart.map(({ productId, quantity, restock }) => ({
            productId,
            quantity,
            restock: restock ?? false
          })),
          reason: returnReason,
          tenders,
          ...(selectedCustomer && { customerId: selectedCustomer.id })
        })
        if (!result.ok) {
          setCheckoutError(result.error.message)
          setConfirmTransaction(false)
          setQuoteRetryKey((key) => key + 1)
          return
        }
        transaction = result.data.return
      } else {
        const result = await window.pos.sales.completeCheckout({
          items: cart.map(({ productId, quantity, priceOverride }) => ({
            productId,
            quantity,
            ...(priceOverride && { priceOverride })
          })),
          tenders,
          ...(selectedCustomer && { customerId: selectedCustomer.id }),
          ...(chargeRemainingBalance && { chargeRemainingBalance: true })
        })
        if (!result.ok) {
          setCheckoutError(result.error.message)
          setConfirmTransaction(false)
          setQuoteRetryKey((key) => key + 1)
          return
        }
        transaction = result.data.sale
      }

      setCompletedSale(transaction)
      setCart((current) => clearCart(current))
      setCheckoutSession(null)
      setSelectedCustomer(null)
      if (mode === 'return') setReturnReason('')
      setPaymentActive(false)
      setTenderDialogType(null)
      setLookupMessage('')
      setLookupIsError(false)
      setConfirmTransaction(false)
      setReceiptDialogSale(transaction)
    } catch {
      setCheckoutError(
        `The ${mode === 'return' ? 'return' : 'sale'} could not be saved. Your cart and staged payments are still available.`
      )
    } finally {
      setSavingSale(false)
    }
  }

  function amount(value: number | undefined): string {
    return value === undefined ? '—' : currencyFormatter.format(value / 100)
  }

  const subtotal = cart.length === 0 ? 0 : quote?.subtotalCents
  const tax = cart.length === 0 ? 0 : quote?.taxCents
  const total = cart.length === 0 ? 0 : quote?.totalCents
  const zeroTotal = quote !== null && quote.totalCents === 0
  const transactionName = mode === 'return' ? 'return' : 'sale'

  return (
    <section
      ref={registerRef}
      className={`pos-page${mode === 'return' ? ' is-return-mode' : ''}`}
      aria-label="Point of sale"
    >
      {completedSale && (
        <div className="sale-success" role="status">
          <span>
            {completedSale.transactionType === 'return' ? 'Return' : 'Invoice'} #
            {completedSale.transactionNumber}{' '}
            {completedSale.transactionType === 'return' ? 'recorded' : 'completed'} ·{' '}
            {currencyFormatter.format(completedSale.totalCents / 100)}
          </span>
          <span className="sale-success-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => setReceiptDialogSale(completedSale)}
            >
              Receipt options
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setCompletedSale(null)
                setReceiptDialogSale(null)
                inputRef.current?.focus()
              }}
            >
              {completedSale.transactionType === 'return' ? 'New return' : 'New sale'}
            </button>
          </span>
        </div>
      )}

      <div className="register-mode-bar">
        <span className="register-mode-label">Register mode</span>
        <div className="register-mode-toggle" role="group" aria-label="Register mode">
          <button
            className={mode === 'sale' ? 'is-active' : ''}
            type="button"
            aria-pressed={mode === 'sale'}
            disabled={pendingLookups > 0 || savingSale || lineSelectionMode !== null}
            onClick={() => changeRegisterMode('sale')}
          >
            Sale
          </button>
          <button
            className={mode === 'return' ? 'is-active' : ''}
            type="button"
            aria-pressed={mode === 'return'}
            disabled={pendingLookups > 0 || savingSale || lineSelectionMode !== null}
            onClick={() => changeRegisterMode('return')}
          >
            Return
          </button>
        </div>
      </div>

      {mode === 'return' && (
        <div className="pos-return-reason">
          <label htmlFor="return-reason-input">Reason for return</label>
          <textarea
            id="return-reason-input"
            rows={2}
            value={returnReason}
            disabled={cartLocked}
            onChange={(event) => setReturnReason(event.target.value)}
            placeholder="Enter why this item is being returned"
            required
          />
          <p>
            Refunds use the current catalog price and tax rates. Card refunds must be processed on
            the terminal.
          </p>
        </div>
      )}

      <div className="pos-customer-selection" aria-label="Customer for this transaction">
        <div>
          <span className="eyebrow">Customer</span>
          <strong>
            {selectedCustomer ? customerName(selectedCustomer) : 'No customer selected'}
          </strong>
          {selectedCustomer?.companyName && <small>{selectedCustomer.companyName}</small>}
        </div>
        <div className="pos-customer-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={
              savingSale || paymentActive || pendingLookups > 0 || lineSelectionMode !== null
            }
            onClick={() => setCustomerLookupOpen(true)}
          >
            {selectedCustomer ? 'Change customer' : 'Select customer'} <kbd>F8</kbd>
          </button>
          {selectedCustomer && (
            <button
              className="text-button danger-text"
              type="button"
              disabled={
                savingSale || paymentActive || pendingLookups > 0 || lineSelectionMode !== null
              }
              onClick={() => setSelectedCustomer(null)}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="pos-register-layout">
        <div className="pos-workspace">
          <div className="pos-cart-card">
            <div className="pos-cart-heading">
              <div>
                <p className="eyebrow">Current {transactionName}</p>
                <h2>Items</h2>
              </div>
              {cart.length > 0 && (
                <button
                  className="text-button danger-text"
                  ref={clearCartButtonRef}
                  type="button"
                  disabled={cartLocked || pendingLookups > 0}
                  onClick={handleClearCart}
                >
                  Clear {mode === 'return' ? 'return' : 'sale'}
                </button>
              )}
            </div>
            {lineSelectionMode !== null && selectedCartLine && selectedCartLineIndex !== null && (
              <div
                className="cart-line-selection-help"
                id="cart-line-selection-help"
                role="status"
                aria-live="polite"
              >
                <strong>
                  {lineSelectionMode === 'remove' ? 'Remove item' : 'Edit item price'}:
                </strong>{' '}
                {selectedCartLine.name} ({selectedCartLine.sku}) · {selectedCartLineIndex + 1} of{' '}
                {cart.length}
                <span>
                  Use ↑/↓ to choose · Enter to{' '}
                  {lineSelectionMode === 'remove' ? 'remove' : 'edit price'} · Esc to cancel
                </span>
              </div>
            )}
            {cart.length === 0 ? (
              <div className="pos-empty-cart">
                <div className="empty-product-mark" aria-hidden="true">
                  ＋
                </div>
                <h3>No items yet</h3>
                <p>Scan a product SKU to start a {transactionName}.</p>
              </div>
            ) : (
              <div className="pos-cart-content">
                <div className="pos-cart-scroll">
                  <table
                    className="pos-cart-table"
                    aria-label={`Items in current ${transactionName}`}
                  >
                    <colgroup>
                      <col className="cart-col-sku" />
                      <col className="cart-col-product" />
                      <col className="cart-col-price" />
                      <col className="cart-col-quantity" />
                      <col className="cart-col-total" />
                      <col className="cart-col-action" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">SKU</th>
                        <th scope="col">Product</th>
                        <th scope="col">Price</th>
                        <th scope="col">Qty</th>
                        <th scope="col">Total</th>
                        <th scope="col">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayLines.map((line, lineIndex) => {
                        const isKeyboardSelected =
                          lineSelectionMode !== null && selectedCartLineIndex === lineIndex
                        return (
                          <tr
                            key={line.productId}
                            ref={(element) => {
                              if (element) cartLineRowRefs.current.set(line.productId, element)
                              else cartLineRowRefs.current.delete(line.productId)
                            }}
                            className={isKeyboardSelected ? 'is-keyboard-selected' : undefined}
                            tabIndex={isKeyboardSelected ? 0 : undefined}
                            aria-selected={
                              lineSelectionMode !== null ? isKeyboardSelected : undefined
                            }
                            aria-describedby={
                              isKeyboardSelected ? 'cart-line-selection-help' : undefined
                            }
                          >
                            <td className="product-sku">{line.sku}</td>
                            <td className="product-name-cell">
                              {line.name}
                              {mode === 'return' && (
                                <label className="return-restock-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={'restock' in line && line.restock === true}
                                    disabled={cartLocked}
                                    onChange={(event) => {
                                      const restock = event.currentTarget.checked
                                      setCart((current) =>
                                        current.map((entry) =>
                                          entry.productId === line.productId
                                            ? { ...entry, restock }
                                            : entry
                                        )
                                      )
                                    }}
                                  />
                                  Restock item
                                </label>
                              )}
                            </td>
                            <td>
                              {mode === 'return' ? (
                                <span className="cart-return-price">
                                  {amount(
                                    mode === 'return' && !('lineTotalCents' in line)
                                      ? -line.unitPriceCents
                                      : line.unitPriceCents
                                  )}
                                </span>
                              ) : (
                                <button
                                  className="cart-price-button"
                                  type="button"
                                  disabled={cartLocked || !quote}
                                  aria-label={`Change price for ${line.name}. Current price ${amount(line.unitPriceCents)}`}
                                  onClick={() => setPriceDialogLine(line as QuoteItem)}
                                >
                                  {amount(line.unitPriceCents)}
                                </button>
                              )}
                              {'priceOverrideReason' in line && line.priceOverrideReason && (
                                <small className="price-adjusted-label">Adjusted</small>
                              )}
                            </td>
                            <td>
                              <div
                                className="cart-quantity-controls"
                                role="group"
                                aria-label={`${line.name} quantity`}
                              >
                                <button
                                  className="quantity-button"
                                  type="button"
                                  aria-label={`Decrease ${line.name} quantity`}
                                  disabled={line.quantity <= 1 || cartLocked}
                                  onClick={() =>
                                    setCart((current) =>
                                      changeCartQuantity(current, line.productId, -1)
                                    )
                                  }
                                >
                                  −
                                </button>
                                <span aria-live="polite">{line.quantity}</span>
                                <button
                                  className="quantity-button"
                                  type="button"
                                  aria-label={`Increase ${line.name} quantity`}
                                  disabled={cartLocked}
                                  onClick={() =>
                                    setCart((current) =>
                                      changeCartQuantity(current, line.productId, 1)
                                    )
                                  }
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="pos-line-total">
                              {currencyFormatter.format(
                                ('lineTotalCents' in line && typeof line.lineTotalCents === 'number'
                                  ? line.lineTotalCents
                                  : (mode === 'return' ? -1 : 1) *
                                    line.unitPriceCents *
                                    line.quantity) / 100
                              )}
                            </td>
                            <td>
                              <button
                                className="text-button danger-text"
                                type="button"
                                aria-label={`Remove ${line.name}`}
                                disabled={cartLocked}
                                onClick={() => {
                                  setCart((current) => removeCartProduct(current, line.productId))
                                  window.requestAnimationFrame(() => inputRef.current?.focus())
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="pos-entry-card">
            <div className="pos-entry-heading">
              <div>
                <p className="eyebrow">
                  {mode === 'return' ? 'Add returned items' : 'Add products'}
                </p>
                <label htmlFor="pos-sku-input">Scan or enter SKU</label>
              </div>
              <span className="keyboard-hint">
                <kbd>F2</kbd> focus <span aria-hidden="true">·</span> <kbd>Enter</kbd> add
              </span>
            </div>
            <form className="pos-sku-form" onSubmit={handleSubmit}>
              <input
                autoComplete="off"
                autoFocus
                disabled={cartLocked}
                id="pos-sku-input"
                ref={inputRef}
                value={skuInput}
                onChange={(event) => setSkuInput(event.target.value)}
                placeholder="Scan or enter product SKU"
                aria-describedby="pos-sku-feedback"
                aria-keyshortcuts="F2 Enter"
              />
              <button className="primary-button" type="submit" disabled={cartLocked}>
                Add item
              </button>
            </form>
            <p
              className={`pos-feedback${lookupIsError ? ' is-error' : ''}`}
              id="pos-sku-feedback"
              aria-live={lookupIsError ? 'assertive' : 'polite'}
              role={lookupIsError ? 'alert' : 'status'}
            >
              {pendingLookups > 0
                ? `Looking up ${pendingLookups} ${pendingLookups === 1 ? 'SKU' : 'SKUs'}…`
                : lookupMessage ||
                  (mode === 'return'
                    ? 'Scan any catalog SKU, including inactive products.'
                    : 'Scan an active product SKU to add it to this sale.')}
            </p>
          </div>
        </div>

        <aside className="pos-checkout-panel" aria-label="Checkout summary">
          <div className="checkout-panel-heading">
            <p className="eyebrow">Checkout</p>
            <h2>{mode === 'return' ? 'Return total' : 'Sale total'}</h2>
          </div>
          <p className="checkout-item-count" aria-live="polite">
            {itemCount} {itemCount === 1 ? 'item' : 'items'} in this {transactionName}
          </p>
          <div className="checkout-summary" aria-live="polite" aria-busy={quoteLoading}>
            <div>
              <span>Subtotal</span>
              <strong>{quoteLoading ? 'Updating…' : amount(subtotal)}</strong>
            </div>
            {!quoteLoading &&
              quote?.taxBreakdown.map((entry) => (
                <div key={`${entry.name}-${entry.rateBasisPoints}`}>
                  <span>
                    {entry.name} ({(entry.rateBasisPoints / 100).toFixed(2)}%)
                  </span>
                  <strong>{amount(entry.taxCents)}</strong>
                </div>
              ))}
            <div>
              <span>Tax total</span>
              <strong>{quoteLoading ? 'Updating…' : amount(tax)}</strong>
            </div>
            <div className="checkout-grand-total">
              <span>{mode === 'return' ? 'Refund total' : 'Total'}</span>
              <strong>{quoteLoading ? 'Updating…' : amount(total)}</strong>
            </div>
          </div>
          {quoteError && (
            <div className="product-banner-error checkout-quote-error">
              <p role="alert">{quoteError}</p>
              <button
                className="text-button"
                type="button"
                disabled={quoteLoading || pendingLookups > 0}
                onClick={() => setQuoteRetryKey((key) => key + 1)}
              >
                Retry totals
              </button>
            </div>
          )}

          {sessionNeedsResume ? (
            <div className="payment-session-notice">
              <p>
                Payment in progress. The cart is locked until this payment is resumed or discarded.
              </p>
              <div className="payment-session-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={!quote}
                  onClick={resumePayment}
                >
                  Resume payment
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={discardPaymentSession}
                >
                  Discard staged payments
                </button>
              </div>
            </div>
          ) : paymentActive ? (
            <div className="checkout-payment-session">
              <div className="payment-session-totals" aria-live="polite">
                <div className="payment-total-card">
                  <span>
                    {mode === 'return'
                      ? 'Total payout'
                      : chargeRemainingBalance
                        ? 'Paid now'
                        : 'Total tendered'}
                  </span>
                  <strong>{amount(totalTenderedCents(tenders))}</strong>
                </div>
                <div className="payment-total-card is-remaining">
                  <span>
                    {mode === 'return'
                      ? 'Remaining to refund'
                      : chargeRemainingBalance
                        ? 'On charge'
                        : 'Remaining'}
                  </span>
                  <strong>
                    {amount(
                      chargeRemainingBalance
                        ? chargeAmountCents
                        : (tenderSummary?.remainingCents ?? total ?? 0)
                    )}
                  </strong>
                </div>
                {mode === 'sale' && Boolean(tenderSummary?.changeCents) && (
                  <div className="payment-total-change">
                    <span>Change due</span>
                    <strong>{amount(tenderSummary?.changeCents)}</strong>
                  </div>
                )}
              </div>
              {tenders.length > 0 && (
                <ul className="staged-payment-list" aria-label="Payments entered">
                  {tenders.map((tender, index) => {
                    let remaining = quote ? Math.abs(quote.totalCents) : 0
                    for (let previous = 0; previous < index; previous += 1) {
                      const prior = tenders[previous]!
                      remaining = Math.max(0, remaining - Math.min(prior.amountCents, remaining))
                    }
                    const invalidCard = tender.type !== 'cash' && tender.amountCents > remaining
                    const applied = invalidCard ? 0 : Math.min(tender.amountCents, remaining)
                    const change = tender.type === 'cash' ? tender.amountCents - applied : 0
                    return (
                      <li key={`${tender.type}-${index}`}>
                        <span>
                          <strong>{tenderLabel(tender.type)}</strong>
                          <small>
                            {mode === 'return'
                              ? `${amount(tender.amountCents)} refunded`
                              : `${amount(tender.amountCents)} tendered · ${amount(applied)} applied${change > 0 ? ` · ${amount(change)} change` : ''}`}
                          </small>
                        </span>
                        <button
                          className="text-button danger-text"
                          type="button"
                          aria-label={`Remove ${tenderLabel(tender.type)} payment ${index + 1}`}
                          onClick={() => removeTender(index)}
                        >
                          Remove
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {chargeRemainingBalance && (
                <ul className="staged-payment-list" aria-label="Charge details">
                  <li>
                    <span>
                      <strong>
                        Charge · {selectedCustomer ? customerName(selectedCustomer) : ''}
                      </strong>
                      <small>{amount(chargeAmountCents)} due after this sale</small>
                    </span>
                    <button
                      className="text-button danger-text"
                      type="button"
                      onClick={() => {
                        setCheckoutSession(tenders.length > 0 ? { tenders } : null)
                        if (tenders.length === 0) setPaymentActive(false)
                        setConfirmTransaction(false)
                        setCheckoutError('')
                      }}
                    >
                      Remove
                    </button>
                  </li>
                </ul>
              )}
              {tenderSummary && !tenderSummary.valid && (
                <p className="product-banner-error" role="alert">
                  {tenderSummary.error} Remove or replace a staged payment to continue.
                </p>
              )}
              {checkoutError && (
                <p className="product-banner-error" role="alert">
                  {checkoutError}
                </p>
              )}
              {tenderSummary?.remainingCents !== 0 && !chargeRemainingBalance && (
                <div className="checkout-payment-actions">
                  <button
                    className="primary-button payment-button"
                    ref={addPaymentButtonRef}
                    type="button"
                    disabled={
                      checkoutDisabled ||
                      tenderSummary?.valid === false ||
                      tenderSummary?.remainingCents === 0
                    }
                    onClick={openTenderPicker}
                  >
                    Add payment
                  </button>
                  <p className="checkout-hint">
                    {mode === 'return'
                      ? 'Cash, Debit, or Credit refund · card refunds are recorded only'
                      : 'Cash, Debit, Credit, or Charge'}
                  </p>
                </div>
              )}
              {tenderSummary?.valid &&
              (tenderSummary.remainingCents === 0 || chargeRemainingBalance) ? (
                <button
                  className="primary-button payment-complete-button"
                  ref={completeTransactionButtonRef}
                  type="button"
                  disabled={savingSale || !quote}
                  onClick={() => setConfirmTransaction(true)}
                >
                  {mode === 'return' ? 'Complete Return' : 'Complete Sale'}
                </button>
              ) : null}
              <button
                className="text-button danger-text"
                type="button"
                onClick={discardPaymentSession}
              >
                {tenders.length > 0 || chargeRemainingBalance
                  ? 'Discard payment session'
                  : 'Return to cart'}
              </button>
            </div>
          ) : zeroTotal ? (
            <div className="checkout-payment-actions">
              <p className="zero-total-note">
                {mode === 'return'
                  ? 'No refund payout is due for this return.'
                  : 'No payment is due for this sale.'}
              </p>
              <button
                className="primary-button payment-complete-button"
                ref={completeTransactionButtonRef}
                type="button"
                disabled={checkoutDisabled}
                onClick={() => {
                  setPaymentActive(true)
                  setCheckoutSession({ tenders: [] })
                  setConfirmTransaction(true)
                }}
              >
                {mode === 'return' ? 'Complete $0 Return' : 'Complete $0 Sale'}
              </button>
            </div>
          ) : (
            <>
              <div className="checkout-payment-actions" aria-label="Add payment">
                <button
                  className="primary-button payment-button"
                  ref={addPaymentButtonRef}
                  type="button"
                  disabled={checkoutDisabled}
                  onClick={openTenderPicker}
                >
                  Add payment
                </button>
              </div>
              <p className="checkout-hint">
                {mode === 'return'
                  ? 'Cash, Debit, or Credit refund · card refunds are recorded only'
                  : 'Cash, Debit, Credit, or Charge'}
              </p>
            </>
          )}
          <div className="register-shortcut-legend" aria-label="Register keyboard shortcuts">
            <p className="eyebrow">Keyboard shortcuts</p>
            <ul>
              <li>
                <kbd>F2</kbd>
                <span>Focus SKU</span>
              </li>
              <li>
                <kbd>R</kbd>
                <span>Toggle Sale / Return</span>
              </li>
              <li>
                <kbd>F3</kbd>
                <span>Products</span>
              </li>
              <li>
                <kbd>F4</kbd>
                <span>Clear cart</span>
              </li>
              <li>
                <kbd>F5</kbd>
                <span>Remove item</span>
              </li>
              <li>
                <kbd>F6</kbd>
                <span>Edit item price (Sale mode)</span>
              </li>
              <li>
                <kbd>F8</kbd>
                <span>Select customer</span>
              </li>
              <li>
                <kbd>F9</kbd>
                <span>Add payment</span>
              </li>
            </ul>
            <p className="shortcut-legend-help">
              F5/F6: use ↑/↓ to select an item, Enter to act, Esc to cancel · Tab to other controls
            </p>
          </div>
        </aside>
      </div>

      {priceDialogLine && (
        <PriceOverrideDialog
          line={priceDialogLine}
          onCancel={() => setPriceDialogLine(null)}
          onApply={applyPriceOverride}
        />
      )}
      {paymentMethodPickerOpen && quote && (
        <PaymentMethodPickerDialog
          isReturn={mode === 'return'}
          onCancel={cancelTenderPicker}
          onSelect={(type) => {
            setPaymentMethodPickerOpen(false)
            if (type === 'charge') beginChargeEntry()
            else beginTender(type)
          }}
        />
      )}
      {customerLookupOpen && (
        <CustomerLookupDialog
          selectedCustomerId={selectedCustomer?.id ?? null}
          onCancel={cancelCustomerLookup}
          onSelect={handleCustomerSelected}
        />
      )}
      {tenderDialogType && quote && (
        <TenderEntryDialog
          isReturn={mode === 'return'}
          initialType={tenderDialogType}
          remainingCents={tenderSummary?.remainingCents ?? paymentTargetCents}
          stagedTenders={tenders}
          totalCents={paymentTargetCents}
          onCancel={cancelTenderEntry}
          onAdd={stageTender}
        />
      )}
      {confirmTransaction && quote && tenderSummary && (
        <CompleteSaleDialog
          isReturn={mode === 'return'}
          totalCents={quote.totalCents}
          tenderedCents={totalTenderedCents(tenders)}
          chargeAmountCents={chargeAmountCents}
          customerName={
            chargeRemainingBalance && selectedCustomer ? customerName(selectedCustomer) : null
          }
          changeCents={tenderSummary.changeCents}
          saving={savingSale}
          error={checkoutError}
          onCancel={cancelTransactionConfirmation}
          onConfirm={() => void completeTransaction()}
        />
      )}

      {receiptDialogSale && (
        <ReceiptDialog sale={receiptDialogSale} onClose={() => setReceiptDialogSale(null)} />
      )}
    </section>
  )
}

interface PriceOverrideDialogProps {
  line: QuoteItem
  onCancel: () => void
  onApply: (priceCents: number, reason: string) => void
}

function PriceOverrideDialog({
  line,
  onCancel,
  onApply
}: PriceOverrideDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [price, setPrice] = useState(centsInput(line.unitPriceCents))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const cents = parseCadCents(price)
    if (cents === null) {
      setError('Enter a non-negative CAD price with up to two decimal places.')
      return
    }
    if (!reason.trim()) {
      setError('Enter a reason for changing this item’s price.')
      return
    }
    onApply(cents, reason.trim())
  }

  return (
    <dialog
      className="product-dialog checkout-dialog"
      ref={dialogRef}
      aria-labelledby="price-override-title"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Transaction price</p>
          <h2 id="price-override-title">Change price for {line.name}</h2>
        </div>
        <button
          className="dialog-close-button"
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="checkout-confirmation price-override-fields">
          <p>Catalog price: {currencyFormatter.format(line.catalogUnitPriceCents / 100)}</p>
          <label>
            <span>New price (CAD)</span>
            <input
              autoFocus
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              aria-label="New price in CAD"
            />
          </label>
          <label>
            <span>Reason for change</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-label="Reason for price change"
            />
          </label>
          {error && (
            <p className="product-banner-error" role="alert">
              {error}
            </p>
          )}
          <p className="price-override-note">This change applies only to this sale.</p>
        </div>
        <div className="dialog-actions checkout-dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            Confirm price change
          </button>
        </div>
      </form>
    </dialog>
  )
}

interface TenderEntryDialogProps {
  isReturn: boolean
  initialType: TenderType
  remainingCents: number
  totalCents: number
  stagedTenders: TenderInput[]
  onCancel: () => void
  onAdd: (tender: TenderInput) => string | null
}

interface PaymentMethodPickerDialogProps {
  isReturn: boolean
  onCancel: () => void
  onSelect: (type: TenderType | 'charge') => void
}

function PaymentMethodPickerDialog({
  isReturn,
  onCancel,
  onSelect
}: PaymentMethodPickerDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const methodRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [focusedMethodIndex, setFocusedMethodIndex] = useState(0)
  const methods: Array<TenderType | 'charge'> = isReturn
    ? ['cash', 'debit', 'credit']
    : ['cash', 'debit', 'credit', 'charge']
  const shortcutByMethod: Record<TenderType | 'charge', string> = {
    cash: '1',
    credit: '2',
    charge: '3',
    debit: '4'
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      methodRefs.current[0]?.focus()
    }
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  function handlePickerKeyDown(event: React.KeyboardEvent<HTMLDialogElement>): void {
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat) {
      const method = resolvePaymentMethodShortcut(event.key, methods)
      if (method) {
        event.preventDefault()
        onSelect(method)
        return
      }
    }

    const nextIndex = nextPaymentMethodIndex(focusedMethodIndex, event.key, methods.length)
    if (nextIndex === null) return
    event.preventDefault()
    setFocusedMethodIndex(nextIndex)
    methodRefs.current[nextIndex]?.focus()
  }

  return (
    <dialog
      className="product-dialog checkout-dialog"
      ref={dialogRef}
      aria-labelledby="payment-method-title"
      aria-describedby="payment-method-keyboard-hint"
      onKeyDown={handlePickerKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">{isReturn ? 'Refund payout' : 'Payment'}</p>
          <h2 id="payment-method-title">Choose a {isReturn ? 'refund' : 'payment'} method</h2>
        </div>
        <button
          className="dialog-close-button"
          type="button"
          aria-label="Close payment method selection"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <div className="checkout-confirmation payment-method-picker-content">
        <div className="payment-method-picker-grid" role="group" aria-label="Payment methods">
          {methods.map((type, index) => (
            <button
              className={type === 'cash' ? 'primary-button' : 'secondary-button'}
              key={type}
              ref={(element) => {
                methodRefs.current[index] = element
              }}
              tabIndex={index === focusedMethodIndex ? 0 : -1}
              type="button"
              aria-label={`${tenderLabel(type)}, shortcut ${shortcutByMethod[type]}`}
              onFocus={() => setFocusedMethodIndex(index)}
              onClick={() => onSelect(type)}
            >
              <span>{tenderLabel(type)}</span>
              <kbd>{shortcutByMethod[type]}</kbd>
            </button>
          ))}
        </div>
        <p className="payment-method-picker-hint" id="payment-method-keyboard-hint">
          Use ← and → to choose a method; ↑ and ↓ move between controls. Press Enter to continue, or{' '}
          {methods.map((type) => `${shortcutByMethod[type]} for ${tenderLabel(type)}`).join(', ')}.
        </p>
      </div>
      <div className="dialog-actions checkout-dialog-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  )
}

function TenderEntryDialog({
  isReturn,
  initialType,
  remainingCents,
  totalCents,
  stagedTenders,
  onCancel,
  onAdd
}: TenderEntryDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const amountInputRef = useRef<HTMLInputElement>(null)
  const type = initialType
  const [amount, setAmount] = useState(initialType === 'cash' ? '' : centsInput(remainingCents))
  const [error, setError] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      amountInputRef.current?.focus()
    }
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const amountCents = parseCadCents(amount)
    if (amountCents === null || amountCents <= 0) {
      setError('Enter a payment amount above $0.00 with up to two decimal places.')
      return
    }
    const tender = { type, amountCents }
    const preview = isReturn
      ? allocateReturnPayouts(totalCents, [...stagedTenders, tender])
      : allocateTenders(totalCents, [...stagedTenders, tender])
    if (!preview.valid) {
      setError(preview.error)
      return
    }
    const result = onAdd(tender)
    if (result) setError(result)
  }

  return (
    <dialog
      className="product-dialog checkout-dialog"
      ref={dialogRef}
      aria-labelledby="tender-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">
            {isReturn ? 'Remaining refund' : 'Remaining balance'}{' '}
            {currencyFormatter.format(remainingCents / 100)}
          </p>
          <h2 id="tender-dialog-title">
            {isReturn ? `Record ${tenderLabel(type)} refund` : `Add ${tenderLabel(type)} payment`}
          </h2>
        </div>
        <button
          className="dialog-close-button"
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="checkout-confirmation price-override-fields">
          <label>
            <span>
              {isReturn
                ? 'Amount paid out (CAD)'
                : type === 'cash'
                  ? 'Amount received (CAD)'
                  : 'Payment amount (CAD)'}
            </span>
            <input
              ref={amountInputRef}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label={
                isReturn
                  ? 'Refund amount paid out in CAD'
                  : type === 'cash'
                    ? 'Cash amount received in CAD'
                    : 'Payment amount in CAD'
              }
            />
          </label>
          {type === 'cash' && !isReturn && (
            <p>Cash over the remaining balance will be recorded as change due.</p>
          )}
          {isReturn && type !== 'cash' && (
            <p>Record the card refund here, then process it separately on the payment terminal.</p>
          )}
          {error && (
            <p className="product-banner-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-actions checkout-dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            {isReturn ? `Record ${tenderLabel(type)} refund` : `Add ${tenderLabel(type)} payment`}
          </button>
        </div>
      </form>
    </dialog>
  )
}

interface CompleteSaleDialogProps {
  isReturn: boolean
  totalCents: number
  tenderedCents: number
  chargeAmountCents: number
  customerName: string | null
  changeCents: number
  saving: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}

function CompleteSaleDialog({
  isReturn,
  totalCents,
  tenderedCents,
  chargeAmountCents,
  customerName,
  changeCents,
  saving,
  error,
  onCancel,
  onConfirm
}: CompleteSaleDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      confirmButtonRef.current?.focus()
    }
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      className="product-dialog checkout-dialog"
      ref={dialogRef}
      aria-labelledby="complete-sale-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">
            {isReturn
              ? 'Refund confirmation'
              : chargeAmountCents > 0
                ? 'Charge confirmation'
                : 'Payment complete'}
          </p>
          <h2 id="complete-sale-title">
            {isReturn ? 'Complete this return?' : 'Complete this sale?'}
          </h2>
        </div>
        <button
          className="dialog-close-button"
          type="button"
          aria-label="Cancel"
          disabled={saving}
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <div className="checkout-confirmation">
        <div className="sale-confirmation-lines">
          <div>
            <span>{isReturn ? 'Return total' : 'Total'}</span>
            <strong>{currencyFormatter.format(totalCents / 100)}</strong>
          </div>
          <div>
            <span>
              {isReturn ? 'Total payout' : chargeAmountCents > 0 ? 'Paid now' : 'Total tendered'}
            </span>
            <strong>{currencyFormatter.format(tenderedCents / 100)}</strong>
          </div>
          {chargeAmountCents > 0 && (
            <div>
              <span>Charged to {customerName}</span>
              <strong>{currencyFormatter.format(chargeAmountCents / 100)}</strong>
            </div>
          )}
        </div>
        {!isReturn && (
          <div className="sale-confirmation-change" aria-live="polite">
            <span>Change due</span>
            <strong>{currencyFormatter.format(changeCents / 100)}</strong>
          </div>
        )}
        {chargeAmountCents > 0 && (
          <p className="settings-help">
            The customer will owe {currencyFormatter.format(chargeAmountCents / 100)} after this
            sale.
          </p>
        )}
        {isReturn && (
          <p className="settings-help">
            Card refunds are recorded here and must be processed separately on the terminal.
          </p>
        )}
        {error && (
          <p className="product-banner-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-actions checkout-dialog-actions">
        <button
          className="primary-button"
          ref={confirmButtonRef}
          type="button"
          disabled={saving}
          onClick={onConfirm}
        >
          {saving
            ? isReturn
              ? 'Saving return…'
              : 'Saving sale…'
            : isReturn
              ? 'Complete Return'
              : 'Complete Sale'}
        </button>
      </div>
    </dialog>
  )
}

export default PosScreen
