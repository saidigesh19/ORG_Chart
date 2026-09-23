import type { OrgNode, OrgPath } from '../types/org'
import { pathKey } from '../lib/org-tree'

type BreadcrumbsProps = {
  trail: { node: OrgNode; path: OrgPath }[]
  onNavigate: (path: OrgPath) => void
}

export function Breadcrumbs({ trail, onNavigate }: BreadcrumbsProps) {
  return (
    <nav className="crumbs" aria-label="Organisation path">
      <ol>
        {trail.map((item, index) => {
          const last = index === trail.length - 1
          return (
            <li key={pathKey(item.path)}>
              {last ? (
                <span aria-current="page">{item.node.name}</span>
              ) : (
                <button type="button" onClick={() => onNavigate(item.path)}>
                  {item.node.name}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
