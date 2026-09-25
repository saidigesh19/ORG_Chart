import type { OrgNode } from '../types/org'
import { divisionTone, headcountLabel, initials } from '../lib/org-tree'

type PersonIdentityProps = {
  node: OrgNode
  showRollup: boolean
  size?: 'hero' | 'card'
  details?: boolean
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

export function PersonIdentity({ node, showRollup, size = 'card', details }: PersonIdentityProps) {
  const badge = headcountLabel(node, showRollup)
  const tone = divisionTone(node.division ?? node.section)
  const showDetails = details ?? size === 'hero'

  return (
    <div className={`identity identity--${size} division-${tone}`}>
      <div className="identity-head">
        <div className="avatar" aria-hidden="true">
          {initials(node.name)}
        </div>
        <div className="identity-copy">
          {node.division ?? node.section ? (
            <p className="identity-dept">{node.division ?? node.section}</p>
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
