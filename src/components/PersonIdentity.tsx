import type { OrgNode } from '../types/org'
import { directReportLabel, divisionTone, headcountLabel, initials, isProjectNode } from '../lib/org-tree'

type PersonIdentityProps = {
  node: OrgNode
  showRollup: boolean
  size?: 'hero' | 'card'
  details?: boolean
  /** Level 1 cards count only people who report directly to that leader. */
  countScope?: 'rollup' | 'direct'
}

function detailFields(node: OrgNode): Array<[string, string]> {
  const rows =
    node.kind === 'project'
      ? [
          ['Category', node.departmentCategory],
        ]
      : [
          ['Employee ID', node.username],
          ['Category', node.departmentCategory],
          ['Project', node.projectName],
          ['TSM', node.tsm],
          ['Type', node.employmentType],
          ['Joined', node.dateOfJoining],
          ['Last day', node.lastWorkingDay],
        ]

  return rows.filter((detail): detail is [string, string] => Boolean(detail[1]))
}

export function PersonDetails({ node }: { node: OrgNode }) {
  const fields = detailFields(node)
  if (!node.email && fields.length === 0) {
    return null
  }

  return (
    <dl className="person-details">
      {node.email ? (
        <div className="is-wide">
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${node.email}`}>{node.email}</a>
          </dd>
        </div>
      ) : null}
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PersonIdentity({ node, showRollup, size = 'card', details, countScope = 'rollup' }: PersonIdentityProps) {
  const badge = countScope === 'direct' ? directReportLabel(node) : headcountLabel(node, showRollup)
  const tone = isProjectNode(node) ? 'project' : divisionTone(node.division ?? node.section)
  const showDetails = details ?? size === 'hero'

  return (
    <div className={`identity identity--${size} division-${tone}`}>
      <div className="identity-head">
        <div className="avatar" aria-hidden="true">
          {initials(node.name)}
        </div>
        <div className="identity-copy">
          {node.departmentCategory ?? node.division ?? node.section ? (
            <p className="identity-dept">{node.departmentCategory ?? node.division ?? node.section}</p>
          ) : null}
          <p className="identity-name">{node.name}</p>
          <p className="identity-title">{node.designation}</p>
          {node.status || badge ? (
            <div className="identity-chips">
              {node.status ? <span className="status-indicator">{node.status}</span> : null}
              {badge ? <span className="badge">{badge}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      {showDetails ? <PersonDetails node={node} /> : null}
    </div>
  )
}
