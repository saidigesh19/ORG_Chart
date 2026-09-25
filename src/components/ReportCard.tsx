import type { KeyboardEvent } from 'react'
import type { OrgNode } from '../types/org'
import { hasProjectChildren, isProjectNode } from '../lib/org-tree'
import { PersonIdentity } from './PersonIdentity'

type ReportCardProps = {
  node: OrgNode
  showRollup: boolean
  onOpen: () => void
}

export function ReportCard({ node, showRollup, onOpen }: ReportCardProps) {
  const hasReports = node.children.length > 0
  const projects = hasProjectChildren(node)
  const hint = isProjectNode(node)
    ? node.designation
    : projects
      ? `${node.children.length} project${node.children.length === 1 ? '' : 's'}`
      : hasReports
        ? `${node.children.length} direct reports`
        : 'Individual contributor'

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }

  return (
    <article
      className="card"
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      aria-label={`${node.division ?? node.section ? `${node.division ?? node.section}, ` : ''}${node.name}, ${node.designation}. ${hint}`}
    >
      <PersonIdentity node={node} showRollup={showRollup} />
      <div className="card-meta">
        <span className="card-hint">{hint}</span>
        <span className="card-chevron" aria-hidden="true">
          →
        </span>
      </div>
    </article>
  )
}
