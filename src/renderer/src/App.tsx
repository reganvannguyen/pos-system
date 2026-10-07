import { useEffect, useState } from 'react'
import PosScreen from './PosScreen'
import ProductsScreen from './ProductsScreen'
import SalesScreen from './SalesScreen'
import SettingsScreen from './SettingsScreen'
import type { CartLine } from './cart'

const views = ['POS', 'Products', 'Sales', 'Settings'] as const
type View = (typeof views)[number]

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
