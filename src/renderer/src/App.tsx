import { useEffect, useRef, useState } from 'react'
import PosScreen from './PosScreen'
import ProductsScreen from './ProductsScreen'
import SalesScreen from './SalesScreen'
import SettingsScreen from './SettingsScreen'
import type { CartLine } from './cart'
import type { CheckoutSession } from './checkout'

const adminViews = ['Products', 'Sales', 'Settings'] as const
type View = 'POS' | (typeof adminViews)[number]

function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<View>('POS')
  const [moreOpen, setMoreOpen] = useState(false)
  const [version, setVersion] = useState('Loading…')
  const [cart, setCart] = useState<CartLine[]>([])
  const [checkoutSession, setCheckoutSession] = useState<CheckoutSession | null>(null)
  const [registerMode, setRegisterMode] = useState<'sale' | 'return'>('sale')
  const [returnReason, setReturnReason] = useState('')
  const moreContainerRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const pageTitleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    void window.pos.app
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion('Unavailable'))
  }, [])

  useEffect(() => {
    if (!moreOpen) return

    function closeOnOutsideClick(event: PointerEvent): void {
      if (!moreContainerRef.current?.contains(event.target as Node)) setMoreOpen(false)
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setMoreOpen(false)
      moreButtonRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [moreOpen])

  function navigateTo(view: View): void {
    setActiveView(view)
    setMoreOpen(false)
    requestAnimationFrame(() => pageTitleRef.current?.focus())
  }

  return (
    <div className="app-shell">
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-title">
            <p className="eyebrow">POS system</p>
            <h1 ref={pageTitleRef} tabIndex={-1}>
              {activeView === 'POS' ? 'Register' : activeView}
            </h1>
          </div>
          <div className="topbar-actions">
            <nav className="primary-navigation" aria-label="Main navigation">
              <button
                className={`topbar-nav-button${activeView === 'POS' ? ' is-active' : ''}`}
                type="button"
                aria-current={activeView === 'POS' ? 'page' : undefined}
                onClick={() => navigateTo('POS')}
              >
                Register
              </button>
              <div className="more-menu-container" ref={moreContainerRef}>
                <button
                  ref={moreButtonRef}
                  className={`topbar-nav-button${activeView !== 'POS' ? ' is-active' : ''}`}
                  type="button"
                  aria-expanded={moreOpen}
                  aria-controls={moreOpen ? 'more-navigation' : undefined}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  More{' '}
                  <span className="menu-caret" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {moreOpen && (
                  <nav id="more-navigation" className="more-menu" aria-label="More pages">
                    {adminViews.map((view) => (
                      <button
                        className={`more-menu-item${activeView === view ? ' is-active' : ''}`}
                        type="button"
                        key={view}
                        aria-current={activeView === view ? 'page' : undefined}
                        onClick={() => navigateTo(view)}
                      >
                        {view === 'Sales' ? 'Sales History' : view}
                      </button>
                    ))}
                  </nav>
                )}
              </div>
            </nav>
            <span className="version-label">Version {version}</span>
          </div>
        </header>

        {activeView === 'POS' ? (
          <PosScreen
            cart={cart}
            setCart={setCart}
            checkoutSession={checkoutSession}
            setCheckoutSession={setCheckoutSession}
            mode={registerMode}
            setMode={setRegisterMode}
            returnReason={returnReason}
            setReturnReason={setReturnReason}
            onNavigateToProducts={() => navigateTo('Products')}
          />
        ) : activeView === 'Products' ? (
          <ProductsScreen />
        ) : activeView === 'Sales' ? (
          <SalesScreen />
        ) : (
          <SettingsScreen />
        )}
      </main>
    </div>
  )
}

export default App
