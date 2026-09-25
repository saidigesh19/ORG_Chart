import type { OrgNode } from '../types/org'
import { rollupHeadcount } from '../lib/org-tree'
import { PersonIdentity } from './PersonIdentity'

type PersonPanelProps = {
  node: OrgNode
  manager?: OrgNode
  showRollup: boolean
  variant?: 'default' | 'popover'
  onOpenManager?: () => void
  onClose?: () => void
}

export function PersonPanel({
  node,
  manager,
  showRollup,
  variant = 'default',
  onOpenManager,
  onClose,
}: PersonPanelProps) {
  const totalReports = Math.max(rollupHeadcount(node) - (node.username ? 1 : 0), 0)
  const compact = variant === 'popover'

  return (
    <aside className={`person-panel ${compact ? 'person-panel--popover' : ''}`} aria-label={`Profile for ${node.name}`}>
      <header className="person-panel-head">
        <div>
          <p className="eyebrow">{compact ? 'Profile' : 'Selected profile'}</p>
          {compact ? null : <p className="person-panel-context">Reporting and assignment overview</p>}
        </div>
        <div className="person-panel-head-end">
          <span className="status-indicator">{node.status ?? 'Status not provided'}</span>
          {onClose ? (
            <button type="button" className="person-panel-close" onClick={onClose} aria-label="Close profile">
              ×
            </button>
          ) : null}
        </div>
      </header>

      <div className="person-panel-body">
        <PersonIdentity node={node} showRollup={showRollup} size={compact ? 'card' : 'hero'} details />

        <div className="person-panel-side">
          <div className="profile-metrics" aria-label="Reporting summary">
            <div>
              <strong>{node.children.length}</strong>
              <span>Direct reports</span>
            </div>
            <div>
              <strong>{totalReports.toLocaleString('en-US')}</strong>
              <span>Total reports</span>
            </div>
          </div>

          {manager ? (
            <div className="manager-line">
              <span>Reports to</span>
              <button type="button" onClick={onOpenManager}>
                <strong>{manager.name}</strong>
                <small>{manager.designation}</small>
              </button>
            </div>
          ) : (
            <div className="manager-line manager-line--root">
              <span>Top-level leadership</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
