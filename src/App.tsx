import { useCallback, useEffect, useMemo, useState } from 'react'
import { applyTheme, readTheme, type Theme } from './lib/theme'
import { loadOrgData } from './lib/load-org'
import {
  flattenSearchIndex,
  formatPeople,
  getNodeAtPath,
  getTrail,
  parentPath,
  parseHashPath,
  rollupHeadcount,
  toHash,
} from './lib/org-tree'
import type { OrgNode, OrgPath } from './types/org'
import { Breadcrumbs } from './components/Breadcrumbs'
import { OrgChart } from './components/OrgChart'
import { PersonIdentity } from './components/PersonIdentity'
import { ReportsGrid } from './components/ReportsGrid'
import { SearchBox } from './components/SearchBox'
import { ThemeToggle } from './components/ThemeToggle'

type ViewMode = 'chart' | 'directory'

export default function App() {
  const [root, setRoot] = useState<OrgNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [path, setPath] = useState<OrgPath>([])
  const [showRollup, setShowRollup] = useState(false)
  const [view, setView] = useState<ViewMode>('chart')
  const [theme, setTheme] = useState<Theme>(() => readTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    loadOrgData()
      .then((data) => {
        if (!cancelled) {
          setRoot(data.root)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Failed to load organisation data.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const navigate = useCallback((next: OrgPath) => {
    setPath(next)
    const hash = toHash(next)
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash)
    }
  }, [])

  useEffect(() => {
    if (!root) {
      return
    }

    const tree = root

    function applyHash() {
      const parsed = parseHashPath(window.location.hash)
      if (!parsed) {
        navigate([])
        return
      }
      if (getNodeAtPath(tree, parsed)) {
        setPath(parsed)
        return
      }
      navigate([])
    }

    applyHash()
    window.addEventListener('popstate', applyHash)
    window.addEventListener('hashchange', applyHash)
    return () => {
      window.removeEventListener('popstate', applyHash)
      window.removeEventListener('hashchange', applyHash)
    }
  }, [root, navigate])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // The profile popup handles Escape first and marks it, so closing the
      // popup does not also step up a level.
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }
      if (path.length > 0) {
        navigate(parentPath(path))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [path, navigate])

  const current = root ? getNodeAtPath(root, path) : null
  const trail = root && current ? getTrail(root, path) : []
  const searchIndex = useMemo(() => (root ? flattenSearchIndex(root) : []), [root])

  if (error) {
    return (
      <main className="shell">
        <div className="status-panel">
          <h1>Unable to load the organisation chart</h1>
          <p>{error}</p>
          <p>Place a valid workbook at <code>public/org-data.xlsx</code> and refresh.</p>
        </div>
      </main>
    )
  }

  if (!root || !current) {
    return (
      <main className="shell">
        <div className="status-panel">
          <p>Loading organisation chart…</p>
        </div>
      </main>
    )
  }

  const rolled = rollupHeadcount(current)

  return (
    <div className={`app ${view === 'chart' ? 'app--chart' : ''}`}>
      <header className="app-bar">
        <div className="app-bar-start">
          <h1 className="app-title">
            <img className="app-logo" src="/icon1.png" alt="iSpace" />
          </h1>
        </div>
        <div className="app-bar-end">
          <SearchBox index={searchIndex} onJump={navigate} />
          <div className="view-switch" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'chart'}
              className={view === 'chart' ? 'is-active' : undefined}
              onClick={() => setView('chart')}
            >
              Chart
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'directory'}
              className={view === 'directory' ? 'is-active' : undefined}
              onClick={() => setView('directory')}
            >
              List
            </button>
          </div>
          <button
            type="button"
            className={`chip ${showRollup ? 'is-active' : ''}`}
            aria-pressed={showRollup}
            onClick={() => setShowRollup(!showRollup)}
            title="Show the total number of people under each person"
          >
            Totals
          </button>
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>
      </header>

      <main className="stage">
        {view === 'chart' ? (
          <OrgChart root={root} selectedPath={path} showRollup={showRollup} onSelect={navigate} />
        ) : (
          <>
            <section className="current" aria-live="polite">
              <p className="current-kicker">{path.length === 0 ? 'Group leadership' : 'Current leader'}</p>
              <PersonIdentity node={current} showRollup={showRollup} size="hero" />
              {showRollup && rolled > 0 ? (
                <p className="current-note">
                  This branch covers {formatPeople(rolled)} when descendant counts are included.
                </p>
              ) : null}
            </section>
            <ReportsGrid parent={current} parentPath={path} showRollup={showRollup} onOpen={navigate} />
          </>
        )}
      </main>

      <div className="path-dock">
        {path.length > 0 ? (
          <button
            type="button"
            className="up-button"
            onClick={() => navigate(parentPath(path))}
            aria-label="Go up one level"
            title="Go up one level"
          >
            ↑
          </button>
        ) : null}
        <Breadcrumbs trail={trail} onNavigate={navigate} />
      </div>
    </div>
  )
}
