import type { MouseEvent } from 'react'
import type { OrgNode } from '../types/org'
import { projectMemberCount } from '../lib/org-tree'

type ManagerProjectListProps = {
  projects: OrgNode[]
  /** Child indexes in the parent node, when projects are not a 0-based prefix. */
  indexes?: number[]
  variant?: 'chart' | 'card'
  selectedIndex?: number | null
  onSelectProject?: (index: number) => void
}

export function ManagerProjectList({
  projects,
  indexes,
  variant = 'card',
  selectedIndex = null,
  onSelectProject,
}: ManagerProjectListProps) {
  if (projects.length === 0) {
    return null
  }

  function onItemClick(event: MouseEvent<HTMLButtonElement>, index: number) {
    if (!onSelectProject) {
      return
    }
    event.stopPropagation()
    onSelectProject(index)
  }

  return (
    <ul className={`manager-project-list manager-project-list--${variant}`}>
      {projects.map((project, index) => {
        const sourceIndex = indexes?.[index] ?? index
        const interactive = Boolean(onSelectProject)
        const selected = selectedIndex === sourceIndex
        const label = `${project.name} (${projectMemberCount(project)})`

        if (interactive) {
          return (
            <li key={project.name}>
              <button
                type="button"
                className={selected ? 'is-selected' : undefined}
                onClick={(event) => onItemClick(event, sourceIndex)}
                title={label}
              >
                <span className="manager-project-list-name">{project.name}</span>
                <span className="manager-project-list-count">({projectMemberCount(project)})</span>
              </button>
            </li>
          )
        }

        return (
          <li key={project.name} title={label}>
            <span className="manager-project-list-name">{project.name}</span>
            <span className="manager-project-list-count">({projectMemberCount(project)})</span>
          </li>
        )
      })}
    </ul>
  )
}
