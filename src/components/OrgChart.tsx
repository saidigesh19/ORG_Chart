import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrgNode, OrgPath } from '../types/org'
import {
  ancestorKeys,
  expandableKeys,
  headcountLabel,
  keysToDepth,
  pathKey,
} from '../lib/org-tree'

type OrgChartProps = {
  root: OrgNode
  selectedPath: OrgPath
  showRollup: boolean
  onSelect: (path: OrgPath) => void
}

type ChartBoxProps = {
  node: OrgNode
  path: OrgPath
  selectedPath: OrgPath
  expanded: Set<string>
  showRollup: boolean
  onSelect: (path: OrgPath) => void
  onToggle: (path: OrgPath) => void
}

/** Teams wider than this are laid out as a roster block instead of a row of branches. */
const ROSTER_THRESHOLD = 4

function ChartBox({ node, path, selectedPath, expanded, showRollup, onSelect, onToggle }: ChartBoxProps) {
  const key = pathKey(path)
  const selected = key === pathKey(selectedPath)
  const onTrail = path.length <= selectedPath.length && path.every((index, i) => selectedPath[i] === index)
  const hasChildren = node.children.length > 0
  const isOpen = hasChildren && expanded.has(key)
  const badge = headcountLabel(node, showRollup)

  const isTeam = node.children.every((child) => child.children.length === 0)
  const unlisted = isTeam && !node.username && node.count != null ? node.count - node.children.length : 0
  const asRoster = isOpen && isTeam && node.children.length > ROSTER_THRESHOLD

  function memberBox(child: OrgNode, index: number) {
    const childPath = [...path, index]
    const childKey = pathKey(childPath)
    return (
      <button
        type="button"
        key={childKey}
        data-path={childKey}
        className={`org-member ${childKey === pathKey(selectedPath) ? 'is-selected' : ''}`}
        onClick={() => onSelect(childPath)}
      >
        <span className="org-member-name">{child.name}</span>
        <span className="org-member-title">{child.designation}</span>
      </button>
    )
  }

  const ghost = unlisted > 0 ? <p className="org-ghost">{unlisted} more not named in data</p> : null

  return (
    <div className="org-node" data-path={key}>
      <div className={`org-box ${selected ? 'is-selected' : ''} ${onTrail ? 'is-trail' : ''}`}>
        <button type="button" className="org-box-main" onClick={() => onSelect(path)}>
          <span className="org-box-name">{node.name}</span>
          <span className="org-box-title">{node.designation}</span>
          {badge ? <span className="org-box-badge">{badge}</span> : null}
        </button>
        {hasChildren ? (
          <button
            type="button"
            className="org-toggle"
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse reports of ${node.name}` : `Expand reports of ${node.name}`}
            onClick={() => onToggle(path)}
          >
            {isOpen ? '−' : '+'} {node.children.length}
          </button>
        ) : null}
      </div>

      {asRoster ? (
        <div className="org-roster">
          {node.children.map(memberBox)}
          {ghost}
        </div>
      ) : null}

      {isOpen && !asRoster ? (
        <div className="org-kids">
          {node.children.map((child, index) => (
            <div className="org-branch" key={pathKey([...path, index])}>
              <ChartBox
                node={child}
                path={[...path, index]}
                selectedPath={selectedPath}
                expanded={expanded}
                showRollup={showRollup}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            </div>
          ))}
          {ghost ? <div className="org-branch">{ghost}</div> : null}
        </div>
      ) : null}

      {!hasChildren && unlisted > 0 ? <div className="org-roster">{ghost}</div> : null}
    </div>
  )
}

export function OrgChart({ root, selectedPath, showRollup, onSelect }: OrgChartProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(keysToDepth(root, 2)))

  const allKeys = useMemo(() => expandableKeys(root), [root])
  const visible = useMemo(() => {
    const next = new Set(expanded)
    ancestorKeys(selectedPath).forEach((key) => next.add(key))
    return next
  }, [expanded, selectedPath])

  useEffect(() => {
    const selected = scrollerRef.current?.querySelector(`[data-path="${pathKey(selectedPath)}"]`)
    selected?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selectedPath, visible])

  function toggle(path: OrgPath) {
    const key = pathKey(path)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <section className="chart-wrap" aria-label="Organisation chart">
      <div className="chart-toolbar">
        <p>Boxes and reporting lines. Click a name to select. Use + / − to open a branch.</p>
        <div className="chart-toolbar-actions">
          <button type="button" className="up-link" onClick={() => setExpanded(new Set(allKeys))}>
            Expand all
          </button>
          <button type="button" className="up-link" onClick={() => setExpanded(new Set(keysToDepth(root, 1)))}>
            Collapse
          </button>
        </div>
      </div>
      <div className="chart-scroller" ref={scrollerRef}>
        <ChartBox
          node={root}
          path={[]}
          selectedPath={selectedPath}
          expanded={visible}
          showRollup={showRollup}
          onSelect={onSelect}
          onToggle={toggle}
        />
      </div>
    </section>
  )
}
