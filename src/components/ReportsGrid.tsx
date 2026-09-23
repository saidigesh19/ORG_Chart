import type { OrgNode, OrgPath } from '../types/org'
import { pathKey } from '../lib/org-tree'
import { ReportCard } from './ReportCard'

type ReportsGridProps = {
  parent: OrgNode
  parentPath: OrgPath
  showRollup: boolean
  onOpen: (path: OrgPath) => void
}

export function ReportsGrid({ parent, parentPath, showRollup, onOpen }: ReportsGridProps) {
  if (parent.children.length === 0) {
    return (
      <div className="empty" role="status">
        <p className="empty-kicker">End of branch</p>
        <h2>No further reports</h2>
        <p>{parent.name} does not have anyone reporting in this chart.</p>
      </div>
    )
  }

  return (
    <section className="reports" aria-label={`Direct reports of ${parent.name}`}>
      <header className="reports-head">
        <h2>Direct reports</h2>
        <p>
          {parent.children.length} {parent.children.length === 1 ? 'person' : 'people'}
        </p>
      </header>
      <div className="grid">
        {parent.children.map((child, index) => {
          const path = [...parentPath, index]
          return (
            <ReportCard
              key={pathKey(path)}
              node={child}
              showRollup={showRollup}
              onOpen={() => onOpen(path)}
            />
          )
        })}
      </div>
    </section>
  )
}
