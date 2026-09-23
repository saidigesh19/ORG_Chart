import { useCallback, useEffect, useMemo, useState } from 'react'
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

type ViewMode = 'chart' | 'directory'

export default function App() {
  const [root, setRoot] = useState<OrgNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [path, setPath] = useState<OrgPath>([])
  const [showRollup, setShowRollup] = useState(false)
  const [view, setView] = useState<ViewMode>('chart')

  useEffect(() => {
    let cancelled = false
    loadOrgData()
      .then((data) => {
        if (!cancelled) {
          setRoot(data)
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
      if (event.key !== 'Escape') {
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
          <p>Place a valid file at <code>public/org-data.json</code> and refresh.</p>
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
      <header className="topbar">
        <div className="brand">
          <p className="brand-kicker">Meridian Group</p>
          <h1>Organisation chart</h1>
        </div>
        <div className="topbar-tools">
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
              Directory
            </button>
          </div>
          <SearchBox index={searchIndex} onJump={navigate} />
          <label className="toggle">
            <input
              type="checkbox"
              checked={showRollup}
              onChange={(event) => setShowRollup(event.target.checked)}
            />
            <span>Rolled-up headcount</span>
          </label>
        </div>
      </header>

      <div className="crumb-row">
        <Breadcrumbs trail={trail} onNavigate={navigate} />
        {path.length > 0 ? (
          <button type="button" className="up-link" onClick={() => navigate(parentPath(path))}>
            Up one level
          </button>
        ) : null}
      </div>

      <main className="shell">
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
    </div>
  )
}
