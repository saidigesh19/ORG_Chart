import type { KeyboardEvent } from 'react'
import type { OrgNode } from '../types/org'
import { PersonIdentity } from './PersonIdentity'

type ReportCardProps = {
  node: OrgNode
  showRollup: boolean
  onOpen: () => void
}

export function ReportCard({ node, showRollup, onOpen }: ReportCardProps) {
  const hasReports = node.children.length > 0

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
      aria-label={`${node.name}, ${node.designation}. ${hasReports ? 'View reports' : 'No further reports'}`}
    >
      <PersonIdentity node={node} showRollup={showRollup} />
      <div className="card-meta">
        <span className="card-hint">{hasReports ? `${node.children.length} direct reports` : 'Individual contributor'}</span>
        <span className="card-chevron" aria-hidden="true">
          →
        </span>
      </div>
    </article>
  )
}
