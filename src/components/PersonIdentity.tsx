import type { OrgNode } from '../types/org'
import { divisionTone, headcountLabel, initials } from '../lib/org-tree'

type PersonIdentityProps = {
  node: OrgNode
  showRollup: boolean
  size?: 'hero' | 'card'
  details?: boolean
}

export function PersonIdentity({ node, showRollup, size = 'card', details }: PersonIdentityProps) {
  const badge = headcountLabel(node, showRollup)
  const tone = divisionTone(node.division ?? node.section)
  const fields = [
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
    <div className={`identity identity--${size} division-${tone}`}>
      <div className="avatar" aria-hidden="true">
        {initials(node.name)}
      </div>
      <div className="identity-copy">
        <p className="identity-name">{node.name}</p>
        <p className="identity-title">{node.designation}</p>
        {badge ? (
          <p className="badge">{badge}</p>
        ) : null}
        {(details ?? size === 'hero') && (node.email || fields.length > 0) ? (
          <dl className="person-details">
            {node.email ? (
              <div>
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
        ) : null}
      </div>
    </div>
  )
}
