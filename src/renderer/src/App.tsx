import { useEffect, useState } from 'react'
import PosScreen from './PosScreen'
import ProductsScreen from './ProductsScreen'
import type { CartLine } from './cart'

const views = ['POS', 'Products', 'Sales', 'Settings'] as const
type View = (typeof views)[number]

const viewDescriptions: Record<Exclude<View, 'POS' | 'Products'>, string> = {
  Sales: 'Completed sales and receipt reprints will appear here.',
  Settings: 'Store details, tax, and printer options will be configured here.'
}

function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<View>('POS')
  const [version, setVersion] = useState('Loading…')
  const [cart, setCart] = useState<CartLine[]>([])

  useEffect(() => {
    void window.pos.app
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion('Unavailable'))
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="POS System">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>POS System</span>
        </div>

        <nav className="navigation" aria-label="Main navigation">
          {views.map((view) => (
            <button
              className={`nav-item${activeView === view ? ' is-active' : ''}`}
              type="button"
              key={view}
              aria-current={activeView === view ? 'page' : undefined}
              onClick={() => setActiveView(view)}
            >
              <span className="nav-indicator" aria-hidden="true" />
              {view}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" aria-hidden="true" />
          <span>Local register</span>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">POS system</p>
            <h1>{activeView}</h1>
          </div>
          <span className="version-label">Version {version}</span>
        </header>

        {activeView === 'POS' ? (
          <PosScreen cart={cart} setCart={setCart} />
        ) : activeView === 'Products' ? (
          <ProductsScreen />
        ) : (
          <section className="content-card" aria-labelledby="welcome-title">
            <div className="content-icon" aria-hidden="true">
              {activeView.charAt(0)}
            </div>
            <p className="eyebrow">Project foundation</p>
            <h2 id="welcome-title">{activeView}</h2>
            <p className="content-copy">{viewDescriptions[activeView]}</p>
            <span className="milestone-tag">M1 · Application shell</span>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
