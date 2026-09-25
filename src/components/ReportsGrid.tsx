import type { OrgNode, OrgPath } from '../types/org'
import { hasProjectChildren, pathKey } from '../lib/org-tree'
import { ReportCard } from './ReportCard'

type ReportsGridProps = {
  parent: OrgNode
  parentPath: OrgPath
  showRollup: boolean
  onOpen: (path: OrgPath) => void
}

export function ReportsGrid({ parent, parentPath, showRollup, onOpen }: ReportsGridProps) {
  const projects = hasProjectChildren(parent)

  if (parent.children.length === 0) {
    return (
      <div className="empty" role="status">
        <p className="empty-kicker">End of branch</p>
        <h2>{parent.kind === 'project' ? 'Project team' : 'No further reports'}</h2>
        <p>
          {parent.kind === 'project'
            ? `${parent.name} is shown as a project, not a reporting line.`
            : `${parent.name} does not have anyone reporting in this chart.`}
        </p>
      </div>
    )
  }

  return (
    <section className="reports" aria-label={projects ? `Projects under ${parent.name}` : `Direct reports of ${parent.name}`}>
      <header className="reports-head">
        <h2>{projects ? 'Projects' : 'Direct reports'}</h2>
        <p>
          {parent.children.length}{' '}
          {projects
            ? parent.children.length === 1
              ? 'project'
              : 'projects'
            : parent.children.length === 1
              ? 'person'
              : 'people'}
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
