import type { OrgNode } from '../types/org'
import { headcountLabel, initials } from '../lib/org-tree'

type PersonIdentityProps = {
  node: OrgNode
  showRollup: boolean
  size?: 'hero' | 'card'
}

export function PersonIdentity({ node, showRollup, size = 'card' }: PersonIdentityProps) {
  const badge = headcountLabel(node, showRollup)

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
      </div>
    </div>
  )
}
