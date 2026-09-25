import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { OrgNode, OrgPath } from '../types/org'
import {
  ancestorKeys,
  divisionTone,
  expandableKeys,
  getNodeAtPath,
  hasProjectChildren,
  headcountLabel,
  isPathWithin,
  isProjectNode,
  keysToDepth,
  parentPath,
  pathKey,
} from '../lib/org-tree'
import { downloadChartImage, downloadChartPdf } from '../lib/export-chart'
import { PersonPanel } from './PersonPanel'

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
  siblingCount: number
  isolate: boolean
}

const POPOVER_WIDTH = 360
const POPOVER_GAP = 12
const HOVER_OPEN_MS = 900
const HOVER_CLOSE_MS = 280

function pathFromKey(key: string): OrgPath {
  if (key === 'root' || key === '') {
    return []
  }
  return key.split('.').map(Number)
}

function deepestVisiblePath(path: OrgPath, expanded: Set<string>): OrgPath {
  let visible: OrgPath = []
  for (let index = 0; index < path.length; index += 1) {
    if (!expanded.has(pathKey(path.slice(0, index)))) {
      break
    }
    visible = path.slice(0, index + 1)
  }
  return visible
}

const LEVEL_OPTIONS: { label: string; depth: number | 'all'; hint: string }[] = [
  { label: 'Top', depth: 0, hint: 'Only the person at the top' },
  { label: 'L1', depth: 1, hint: 'Top person and their direct reports' },
  { label: 'L2', depth: 2, hint: 'Two reporting levels, then projects under L2' },
]

function findCard(scroller: HTMLElement | null, path: OrgPath): HTMLElement | null {
  const node = scroller?.querySelector<HTMLElement>(`[data-path="${pathKey(path)}"]`)
  if (!node) {
    return null
  }
  return node.matches('button') ? node : node.querySelector<HTMLElement>('.org-box-main')
}

function ChartBox({
  node,
  path,
  selectedPath,
  expanded,
  showRollup,
  onSelect,
  siblingCount,
  isolate,
}: ChartBoxProps) {
  const key = pathKey(path)
  const selected = key === pathKey(selectedPath)
  const onTrail = path.length <= selectedPath.length && path.every((index, i) => selectedPath[i] === index)
  const hasChildren = node.children.length > 0
  const isOpen = hasChildren && expanded.has(key)
  const badge = headcountLabel(node, showRollup)
  const tone = divisionTone(node.division ?? node.section)
  const projectCount = hasProjectChildren(node) ? node.children.length : 0

  // While a branch is isolated, an ancestor of the selection shows only the
  // child that leads to it, so peer branches do not crowd the view.
  const leadsToSelection = isolate && path.length < selectedPath.length && isPathWithin(selectedPath, path)
  const shownChildren = node.children
    .map((child, index) => ({ child, index }))
    .filter(({ index }) => !leadsToSelection || index === selectedPath[path.length])
  const hiddenPeers = node.children.length - shownChildren.length

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const index = path[path.length - 1] ?? 0
    let destination: OrgPath | null = null
    if (event.key === 'ArrowUp' && path.length > 0) destination = parentPath(path)
    if (event.key === 'ArrowDown' && hasChildren) destination = [...path, 0]
    if (event.key === 'ArrowLeft' && path.length > 0 && index > 0) {
      destination = [...path.slice(0, -1), index - 1]
    }
    if (event.key === 'ArrowRight' && path.length > 0 && index < siblingCount - 1) {
      destination = [...path.slice(0, -1), index + 1]
    }
    if (destination) {
      event.preventDefault()
      onSelect(destination)
    }
  }

  return (
    <div
      className="org-node"
      data-path={key}
      role="treeitem"
      aria-level={path.length + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? isOpen : undefined}
    >
      <button
        type="button"
        className={`org-box org-box-main division-${tone} ${selected ? 'is-selected' : ''} ${onTrail ? 'is-trail' : ''} ${isProjectNode(node) ? 'is-project' : ''}`}
        aria-expanded={hasChildren ? isOpen : undefined}
        onClick={() => onSelect(path)}
        onKeyDown={onKeyDown}
      >
        <span className="org-box-body">
          {node.division ?? node.section ? (
            <span className="org-box-dept">{node.division ?? node.section}</span>
          ) : null}
          <span className="org-box-name">{node.name}</span>
          <span className="org-box-title">{node.designation}</span>
          {projectCount > 0 || badge ? (
            <span className="org-box-meta">
              {projectCount > 0 ? (
                <span className="org-box-projects">
                  {projectCount} {projectCount === 1 ? 'project' : 'projects'}
                </span>
              ) : null}
              {badge ? <span className="org-box-badge">{badge}</span> : null}
            </span>
          ) : null}
        </span>
      </button>

      {isOpen && hiddenPeers > 0 ? (
        <p className="org-hidden-note">
          {hiddenPeers} peer {hiddenPeers === 1 ? 'branch' : 'branches'} hidden
        </p>
      ) : null}

      {isOpen ? (
        <div className="org-kids" role="group">
          {shownChildren.map(({ child, index }) => (
            <div className="org-branch" key={pathKey([...path, index])}>
              <ChartBox
                node={child}
                path={[...path, index]}
                selectedPath={selectedPath}
                expanded={expanded}
                showRollup={showRollup}
                onSelect={onSelect}
                siblingCount={node.children.length}
                isolate={isolate}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function OrgChart({ root, selectedPath, showRollup, onSelect }: OrgChartProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(keysToDepth(root, 1)))
  const [focusPath, setFocusPath] = useState<OrgPath | null>(null)
  const [zoom, setZoom] = useState(100)
  const [zoomLocked, setZoomLocked] = useState(false)
  const hasFitted = useRef(false)
  const zoomRef = useRef(100)
  const zoomAnchor = useRef<{
    x: number
    y: number
    scrollLeft: number
    scrollTop: number
    zoom: number
  } | null>(null)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [isolate, setIsolate] = useState(false)
  const [dockOpen, setDockOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [previewPath, setPreviewPath] = useState<OrgPath>([])
  const [profileAt, setProfileAt] = useState<{ top: number; left: number } | null>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const profileOpenRef = useRef(false)
  const skipRevealRef = useRef(false)
  const [levelPreset, setLevelPreset] = useState<number | 'all' | null>(1)
  const [exporting, setExporting] = useState<'image' | 'pdf' | null>(null)
  const levelsId = useId()
  const zoomId = useId()
  const dockPanelId = useId()

  const activeFocusPath = focusPath && isPathWithin(selectedPath, focusPath) ? focusPath : null
  const chartRoot = activeFocusPath ? getFocusedNode(root, activeFocusPath) : root
  const chartRootPath = activeFocusPath ?? []

  // Reveal a newly selected person and their team once, rather than forcing
  // ancestors open on every render, which would defeat the collapse controls.
  const [revealedKey, setRevealedKey] = useState(() => pathKey(selectedPath))
  if (revealedKey === pathKey(selectedPath)) {
    skipRevealRef.current = false
  } else {
    const previousPath = pathFromKey(revealedKey)
    const clipping = isPathWithin(previousPath, selectedPath) && selectedPath.length < previousPath.length
    const skipReveal = skipRevealRef.current
    skipRevealRef.current = false
    setRevealedKey(pathKey(selectedPath))
    if (!clipping && !skipReveal) {
      const reveal = [...ancestorKeys(selectedPath), pathKey(selectedPath)]
      if (reveal.some((key) => !expanded.has(key))) {
        setExpanded((prev) => {
          const next = new Set(prev)
          reveal.forEach((key) => next.add(key))
          return next
        })
      }
    }
  }

  useEffect(() => {
    profileOpenRef.current = profileOpen
  }, [profileOpen])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    if (!dockOpen) {
      return
    }

    function onPointerDown(event: PointerEvent) {
      if (!dockRef.current?.contains(event.target as Node)) {
        setDockOpen(false)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !profileOpen) {
        setDockOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [dockOpen, profileOpen])

  useEffect(() => {
    const target = findCard(scrollerRef.current, selectedPath)
    target?.scrollIntoView({ block: 'nearest', inline: 'center' })
    target?.focus({ preventScroll: true })
  }, [selectedPath, expanded])

  useEffect(() => {
    if (isolate) {
      return
    }
    const visible = deepestVisiblePath(selectedPath, expanded)
    if (pathKey(visible) !== pathKey(selectedPath)) {
      onSelect(visible)
    }
  }, [expanded, isolate, selectedPath, onSelect])

  function clearHoverTimers() {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function showPreview(path: OrgPath) {
    profileOpenRef.current = true
    setPreviewPath(path)
    setProfileOpen(true)
  }

  function hidePreview() {
    profileOpenRef.current = false
    setProfileOpen(false)
  }

  function schedulePreview(path: OrgPath) {
    clearHoverTimers()
    if (profileOpenRef.current) {
      showPreview(path)
      return
    }
    openTimer.current = window.setTimeout(() => showPreview(path), HOVER_OPEN_MS)
  }

  function scheduleHide() {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
    }
    closeTimer.current = window.setTimeout(hidePreview, HOVER_CLOSE_MS)
  }

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }

    function personFromEvent(target: EventTarget | null): OrgPath | null {
      const host = (target as HTMLElement | null)?.closest('.org-box')
      if (!host) {
        return null
      }
      const marked = host.closest('[data-path]') as HTMLElement | null
      return marked?.dataset.path ? pathFromKey(marked.dataset.path) : null
    }

    function onPointerOver(event: PointerEvent) {
      if (event.pointerType === 'touch') {
        return
      }
      const path = personFromEvent(event.target)
      if (!path) {
        return
      }
      schedulePreview(path)
    }

    function onPointerOut(event: PointerEvent) {
      if (event.pointerType === 'touch') {
        return
      }
      const next = event.relatedTarget as HTMLElement | null
      if (next?.closest('.org-box, .person-popover')) {
        return
      }
      scheduleHide()
    }

    scroller.addEventListener('pointerover', onPointerOver)
    scroller.addEventListener('pointerout', onPointerOut)
    return () => {
      scroller.removeEventListener('pointerover', onPointerOver)
      scroller.removeEventListener('pointerout', onPointerOut)
      clearHoverTimers()
    }
  }, [])

  // Keep the floating profile beside its card as the chart scrolls or resizes.
  useEffect(() => {
    if (!profileOpen) {
      return
    }
    const scroller = scrollerRef.current

    function place() {
      const card = findCard(scroller, previewPath)
      if (!card) {
        setProfileAt(null)
        return
      }
      const rect = card.getBoundingClientRect()
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - POPOVER_GAP * 2)
      const spaceRight = window.innerWidth - rect.right - POPOVER_GAP
      const spaceLeft = rect.left - POPOVER_GAP
      let left = rect.right + POPOVER_GAP
      let top = rect.top
      if (spaceRight >= width) {
        left = rect.right + POPOVER_GAP
      } else if (spaceLeft >= width) {
        left = rect.left - POPOVER_GAP - width
      } else {
        left = Math.min(Math.max(POPOVER_GAP, rect.left), window.innerWidth - width - POPOVER_GAP)
        top = rect.bottom + POPOVER_GAP
      }
      setProfileAt({ top: Math.max(POPOVER_GAP, top), left: Math.max(POPOVER_GAP, left) })
    }

    place()
    window.addEventListener('resize', place)
    scroller?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('resize', place)
      scroller?.removeEventListener('scroll', place)
    }
  }, [profileOpen, previewPath, expanded, zoom, compact, isolate])

  // The profile is only measurable once rendered, so lift it if it would run
  // off the bottom of the screen.
  useLayoutEffect(() => {
    const element = popoverRef.current
    if (!element || !profileAt) {
      return
    }
    const width = Math.min(element.offsetWidth, window.innerWidth - POPOVER_GAP * 2)
    const highest = window.innerHeight - element.offsetHeight - POPOVER_GAP
    const rightmost = window.innerWidth - width - POPOVER_GAP
    const top = Math.max(POPOVER_GAP, Math.min(profileAt.top, highest))
    const left = Math.max(POPOVER_GAP, Math.min(profileAt.left, rightmost))
    if (Math.abs(top - profileAt.top) > 1 || Math.abs(left - profileAt.left) > 1) {
      setProfileAt({ top, left })
    }
  }, [profileAt])

  useEffect(() => {
    if (!profileOpen) {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Marks the key as handled so the page does not also navigate up a level.
        event.preventDefault()
        setProfileOpen(false)
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (popoverRef.current?.contains(target)) {
        return
      }
      if (target?.closest('.org-box')) {
        return
      }
      setProfileOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [profileOpen])

  const toggle = useCallback((path: OrgPath) => {
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
  }, [])

  // Click expands or collapses. Details appear on hover, except on touch
  // devices where hover is not available.
  const activate = useCallback(
    (path: OrgPath) => {
      onSelect(path)
      if (pathKey(path) === pathKey(selectedPath)) {
        toggle(path)
      }
      setLevelPreset(null)
      if (window.matchMedia('(hover: hover)').matches) {
        return
      }
      setPreviewPath(path)
      setProfileOpen(true)
    },
    [selectedPath, toggle, onSelect],
  )

  const fitToView = useCallback((mode: 'auto' | 'strict' = 'strict') => {
    const scroller = scrollerRef.current
    const canvas = canvasRef.current
    if (!scroller || !canvas) {
      return
    }
    const previous = canvas.style.zoom
    canvas.style.zoom = '1'
    const width = Math.max(canvas.scrollWidth, 1)
    const height = Math.max(canvas.scrollHeight, 1)
    canvas.style.zoom = previous
    const pad = 40
    const scale = Math.min((scroller.clientWidth - pad) / width, (scroller.clientHeight - pad) / height, 1)
    const narrow = scroller.clientWidth < 760
    const floor = mode === 'auto' && narrow ? 70 : narrow ? 22 : 28
    const next = Math.max(floor, Math.min(100, Math.round(scale * 100)))
    setZoom((current) => (Math.abs(current - next) <= 1 ? current : next))
    setZoomLocked(false)
  }, [])

  useLayoutEffect(() => {
    if (hasFitted.current) {
      return
    }
    const canvas = canvasRef.current
    const scroller = scrollerRef.current
    if (!canvas || !scroller || canvas.scrollWidth < 10) {
      return
    }
    hasFitted.current = true
    fitToView('strict')
  }, [fitToView, chartRoot, expanded])

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    const scroller = scrollerRef.current
    if (!anchor || !scroller) {
      return
    }
    zoomAnchor.current = null
    const ratio = zoom / anchor.zoom
    scroller.scrollLeft = (anchor.scrollLeft + anchor.x) * ratio - anchor.x
    scroller.scrollTop = (anchor.scrollTop + anchor.y) * ratio - anchor.y
  }, [zoom])

  useEffect(() => {
    const stage = scrollerRef.current
    if (!stage) {
      return
    }

    function onWheel(event: WheelEvent) {
      const host = scrollerRef.current
      if (!host || (!event.ctrlKey && !event.metaKey)) {
        return
      }
      event.preventDefault()
      const next = Math.min(130, Math.max(40, Math.round(zoomRef.current - event.deltaY * 0.08)))
      if (next === zoomRef.current) {
        return
      }
      const box = host.getBoundingClientRect()
      zoomAnchor.current = {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        scrollLeft: host.scrollLeft,
        scrollTop: host.scrollTop,
        zoom: zoomRef.current,
      }
      setZoomLocked(true)
      setZoom(next)
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    function onResize() {
      if (!zoomLocked) {
        fitToView('auto')
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [zoomLocked, fitToView])

  // The level controls describe the whole structure, so they release isolation
  // and replace the open set. Skip the usual "reveal selection" expand so a
  // selected person below this level cannot reopen their team.
  function showLevels(depth: number | 'all') {
    setIsolate(false)
    setLevelPreset(depth)
    skipRevealRef.current = true
    if (depth === 'all') {
      setExpanded(new Set(expandableKeys(chartRoot, chartRootPath)))
      return
    }
    setExpanded(new Set(keysToDepth(chartRoot, chartRootPath.length + depth, chartRootPath)))
    const clipped = selectedPath.slice(0, depth)
    setRevealedKey(pathKey(clipped))
    if (pathKey(clipped) !== pathKey(selectedPath)) {
      onSelect(clipped)
    }
  }

  async function exportChart(kind: 'image' | 'pdf') {
    const canvas = canvasRef.current
    if (!canvas || exporting) {
      return
    }
    setProfileOpen(false)
    setExporting(kind)
    try {
      if (kind === 'image') {
        await downloadChartImage(canvas)
      } else {
        await downloadChartPdf(canvas)
      }
    } catch {
      window.alert('Could not download the chart. Try again.')
    } finally {
      setExporting(null)
    }
  }

  const zoomStyle = { '--chart-zoom': zoom / 100 } as CSSProperties
  const previewNode = getNodeAtPath(root, previewPath)
  const managerNode = previewPath.length > 0 ? getNodeAtPath(root, parentPath(previewPath)) ?? undefined : undefined

  const currentLevel = LEVEL_OPTIONS.find((option) => option.depth === levelPreset) ?? LEVEL_OPTIONS[1]

  return (
    <section className={`chart-wrap ${exporting ? 'is-exporting' : ''}`} aria-label="Organisation chart">
      {activeFocusPath ? (
        <div className="focus-banner">
          <span>
            Showing <strong>{chartRoot.name}</strong> as the top of the chart
          </span>
          <button type="button" className="chip" onClick={() => setFocusPath(null)}>
            Show full organisation
          </button>
        </div>
      ) : null}
      <div className={`chart-scroller ${compact ? 'is-compact' : ''} ${dockOpen ? 'has-dock' : ''}`} ref={scrollerRef} role="tree">
        <div className="chart-canvas" ref={canvasRef} style={zoomStyle}>
          <ChartBox
            node={chartRoot}
            path={chartRootPath}
            selectedPath={selectedPath}
            expanded={expanded}
            showRollup={showRollup}
            onSelect={activate}
            siblingCount={1}
            isolate={isolate}
          />
        </div>
      </div>
      <p className="sr-only">
        Hover a person to see their details. Click to expand or collapse their reports. Use arrow keys to move: up to
        the manager, down to the first report, left and right between peers.
      </p>

      {profileOpen && previewNode && profileAt ? (
        <div
          className="person-popover"
          ref={popoverRef}
          style={{ top: profileAt.top, left: profileAt.left }}
          role="dialog"
          aria-label={`Profile for ${previewNode.name}`}
          onPointerEnter={clearHoverTimers}
          onPointerLeave={scheduleHide}
        >
          <PersonPanel
            node={previewNode}
            manager={managerNode}
            showRollup={showRollup}
            variant="popover"
            onOpenManager={managerNode ? () => activate(parentPath(previewPath)) : undefined}
            onClose={() => setProfileOpen(false)}
          />
        </div>
      ) : null}

      <aside className={`chart-dock ${dockOpen ? 'is-open' : ''}`} ref={dockRef} aria-label="Chart controls">
        <button
          type="button"
          className="dock-tab"
          aria-expanded={dockOpen}
          aria-controls={dockPanelId}
          onClick={() => setDockOpen((open) => !open)}
        >
          <span>Options</span>
          <span className="dock-tab-mark" aria-hidden="true">
            {dockOpen ? '−' : '+'}
          </span>
        </button>

        {dockOpen ? (
          <div className="dock-body" id={dockPanelId}>
            <section className="dock-block">
              <p className="dock-title" id={`${levelsId}-label`}>
                Show
              </p>
              <p className="dock-hint">{currentLevel.hint}</p>
              <div className="dock-levels" role="group" aria-labelledby={`${levelsId}-label`}>
                {LEVEL_OPTIONS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={levelPreset === option.depth}
                    className={levelPreset === option.depth ? 'is-active' : undefined}
                    onClick={() => showLevels(option.depth)}
                    title={option.hint}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="dock-block">
              <div className="dock-row">
                <p className="dock-title" id={`${zoomId}-label`}>
                  Size
                </p>
                <span className="dock-zoom-value">{zoom}%</span>
              </div>
              <div className="dock-zoom" role="group" aria-labelledby={`${zoomId}-label`}>
                <input
                  type="range"
                  min={40}
                  max={130}
                  step={5}
                  value={zoom}
                  aria-valuetext={`${zoom} percent`}
                  onChange={(event) => {
                    setZoomLocked(true)
                    setZoom(Number(event.target.value))
                  }}
                />
                <button type="button" className="dock-fit" onClick={() => fitToView('strict')}>
                  Fit
                </button>
              </div>
            </section>

            <section className="dock-block dock-switches">
              <div className="dock-switch">
                <span>This branch</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isolate}
                  className={isolate ? 'is-on' : undefined}
                  title="Hide other teams"
                  onClick={() => {
                    setIsolate(!isolate)
                    if (!isolate) {
                      setLevelPreset(null)
                      setExpanded(new Set([...ancestorKeys(selectedPath), pathKey(selectedPath)]))
                    }
                  }}
                />
              </div>
              <div className="dock-switch">
                <span>Compact cards</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={compact}
                  className={compact ? 'is-on' : undefined}
                  title="Fit more people"
                  onClick={() => setCompact(!compact)}
                />
              </div>
              {!activeFocusPath && selectedPath.length > 0 ? (
                <button
                  type="button"
                  className="dock-action"
                  title="Make this person the top"
                  onClick={() => {
                    setFocusPath(selectedPath)
                    setExpanded((current) => new Set(current).add(pathKey(selectedPath)))
                  }}
                >
                  Start from here
                </button>
              ) : null}
            </section>

            <section className="dock-block">
              <p className="dock-title">Download</p>
              <p className="dock-hint">Current org chart only</p>
              <div className="dock-levels" role="group" aria-label="Download chart">
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void exportChart('image')}
                >
                  {exporting === 'image' ? 'Saving…' : 'Image'}
                </button>
                <button
                  type="button"
                  disabled={exporting !== null}
                  onClick={() => void exportChart('pdf')}
                >
                  {exporting === 'pdf' ? 'Saving…' : 'PDF'}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </section>
  )
}

function getFocusedNode(root: OrgNode, path: OrgPath): OrgNode {
  let current = root
  for (const index of path) {
    current = current.children[index] ?? current
  }
  return current
}
