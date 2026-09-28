import type { KeyboardEvent } from 'react'
import type { OrgNode } from '../types/org'
import { divisionTone, hasProjectChildren, isProjectNode } from '../lib/org-tree'
import { ManagerProjectList } from './ManagerProjectList'
import { PersonIdentity } from './PersonIdentity'

type ReportCardProps = {
  node: OrgNode
  showRollup: boolean
  countScope?: 'rollup' | 'direct'
  onOpen: () => void
}

export function ReportCard({ node, showRollup, countScope = 'rollup', onOpen }: ReportCardProps) {
  const hasReports = node.children.length > 0
  const projects = hasProjectChildren(node)
  const tone = isProjectNode(node) ? 'project' : divisionTone(node.division ?? node.section)
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
      className={`card division-${tone}${isProjectNode(node) ? ' is-project' : ''}`}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      aria-label={`${node.departmentCategory ?? node.division ?? node.section ? `${node.departmentCategory ?? node.division ?? node.section}, ` : ''}${node.name}, ${node.designation}. ${hint}`}
    >
      <PersonIdentity node={node} showRollup={showRollup} countScope={countScope} />
      {projects ? (
        <>
          <div className="card-meta">
            <span className="card-hint">{hint}</span>
          </div>
          <ManagerProjectList projects={node.children} variant="card" />
        </>
      ) : (
        <div className="card-meta">
          <span className="card-hint">{hint}</span>
          <span className="card-chevron" aria-hidden="true">
            →
          </span>
        </div>
      )}
    </article>
  )
}
