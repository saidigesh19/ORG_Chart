import type { OrgNode } from '../types/org'
import { divisionTone, hasProjectChildren, isProjectNode, rollupHeadcount } from '../lib/org-tree'
import { PersonDetails, PersonIdentity } from './PersonIdentity'

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
  const tone = divisionTone(node.division ?? node.section)
  const project = isProjectNode(node)
  const peopleOnProject = node.members?.length ?? node.count ?? 0

  return (
    <aside
      className={`person-panel ${compact ? 'person-panel--popover' : ''} division-${tone}`}
      aria-label={`Profile for ${node.name}`}
    >
      {compact ? (
        onClose ? (
          <button type="button" className="person-panel-close" onClick={onClose} aria-label="Close profile">
            ×
          </button>
        ) : null
      ) : (
        <header className="person-panel-head">
          <div>
            <p className="eyebrow">Selected profile</p>
            <p className="person-panel-context">Reporting and assignment overview</p>
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
      )}

      <div className="person-panel-body">
        <PersonIdentity node={node} showRollup={showRollup} size={compact ? 'card' : 'hero'} details={!compact} />

        <div className="person-panel-side">
          <div className="profile-metrics" aria-label="Reporting summary">
            {project ? (
              <>
                <div>
                  <strong>{peopleOnProject.toLocaleString('en-US')}</strong>
                  <span>People</span>
                </div>
                <div>
                  <strong>{node.department ?? '—'}</strong>
                  <span>Department</span>
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>{node.children.length}</strong>
                  <span>{hasProjectChildren(node) ? 'Projects' : 'Direct reports'}</span>
                </div>
                <div>
                  <strong>{totalReports.toLocaleString('en-US')}</strong>
                  <span>Total reports</span>
                </div>
              </>
            )}
          </div>

          {compact ? <PersonDetails node={node} /> : null}

          {project && node.members && node.members.length > 0 ? (
            <ul className="project-members">
              {node.members.slice(0, 10).map((member) => (
                <li key={member.username ?? member.name}>
                  <strong>{member.name}</strong>
                  <small>{member.designation}</small>
                </li>
              ))}
              {node.members.length > 10 ? (
                <li className="project-members-more">+{node.members.length - 10} more</li>
              ) : null}
            </ul>
          ) : null}

          {manager ? (
            <div className="manager-line">
              <span>{project ? 'Under' : 'Reports to'}</span>
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
