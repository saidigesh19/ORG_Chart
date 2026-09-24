import type { OrgNode } from '../types/org'
import { headcountLabel, initials } from '../lib/org-tree'

type PersonIdentityProps = {
  node: OrgNode
  showRollup: boolean
  size?: 'hero' | 'card'
}

export function PersonIdentity({ node, showRollup, size = 'card' }: PersonIdentityProps) {
  const badge = headcountLabel(node, showRollup)
  const details = [
    ['Employee ID', node.username],
    ['Status', node.status],
    ['Division', node.division],
    ['Department', node.department],
    ['Department category', node.departmentCategory],
    ['Project', node.projectName],
    ['TSM', node.tsm],
    ['Last working day', node.lastWorkingDay],
  ].filter((detail): detail is [string, string] => Boolean(detail[1]))

  return (
    <div className={`identity identity--${size}`}>
      <div className="avatar" aria-hidden="true">
        {initials(node.name)}
      </div>
      <div className="identity-copy">
        <p className="identity-name">{node.name}</p>
        <p className="identity-title">{node.designation}</p>
        {badge ? (
          <p className={`badge ${node.section ? `badge--${node.section.toLowerCase()}` : 'badge--neutral'}`}>
            {badge}
          </p>
        ) : null}
        {size === 'hero' && (node.email || details.length > 0) ? (
          <dl className="person-details">
            {node.email ? (
              <div>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${node.email}`}>{node.email}</a>
                </dd>
              </div>
            ) : null}
            {details.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  )
}
