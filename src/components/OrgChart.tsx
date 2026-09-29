import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { flushSync } from 'react-dom'
import type { OrgNode, OrgPath } from '../types/org'
import {
  ancestorKeys,
  directReportLabel,
  divisionTone,
  expandableKeys,
  getNodeAtPath,
  headcountLabel,
  isPathWithin,
  isProjectNode,
  keysToDepth,
  leadershipOffset,
  parentPath,
  pathKey,
} from '../lib/org-tree'
import {
  captureChartCanvas,
  downloadChartImage,
  downloadChartPdf,
  placeChartOnPaper,
  type ChartExportSetup,
  type PageDepth,
} from '../lib/export-chart'
import { ExportDialog } from './ExportDialog'
import { ManagerProjectList } from './ManagerProjectList'
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
  siblingIndexes: number[]
  isolate: boolean
  /** Path of the node whose children are the choosable branches. */
  branchParentPath: OrgPath
  /** null shows every branch. Otherwise only these branch path keys stay. */
  branchKeys: Set<string> | null
  /**
   * Path length of the node whose direct children should be arranged as a
   * rectangular grid instead of a horizontal row. Used to lay out L2 leaders
   * (the children of each L1) in a wrapping rectangle.
   */
  gridDepth: number
  /** Path length of a level 1 leader, measured from the organisation root. */
  level1Depth: number
}

/**
 * Pick a column count that keeps the rectangle roughly squarish (slightly
 * wider than tall) without exploding on very large teams.
 */
function rectangularColumns(count: number): number {
  if (count <= 1) {
    return 1
  }
  const raw = Math.round(Math.sqrt(count * 1.6))
  return Math.min(5, Math.max(2, raw))
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
  { label: 'Top', depth: 0, hint: 'CEO and the operating lead' },
  { label: 'L1', depth: 1, hint: 'The same L1 leaders as before' },
  { label: 'L2', depth: 2, hint: 'L2 leaders with their projects listed on each card' },
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
  siblingIndexes,
  isolate,
  branchParentPath,
  branchKeys,
  gridDepth,
  level1Depth,
}: ChartBoxProps) {
  const key = pathKey(path)
  const selected = key === pathKey(selectedPath)
  const onTrail = path.length <= selectedPath.length && path.every((index, i) => selectedPath[i] === index)
  const indexedChildren = node.children.map((child, index) => ({ child, index }))
  const projectEntries = indexedChildren.filter(({ child }) => isProjectNode(child))
  const personEntries = indexedChildren.filter(({ child }) => !isProjectNode(child))
  const sideEntries = personEntries.filter(({ child, index }) => {
    if (child.layout !== 'side') {
      return false
    }
    return !branchKeys || branchKeys.has(pathKey([...path, index]))
  })
  const spineEntries = personEntries.filter(({ child }) => child.layout !== 'side')
  const inlineProjects = projectEntries.length > 0
  const projectCount = projectEntries.length
  const hasChildren = spineEntries.length > 0
  const isOpen = hasChildren && expanded.has(key)
  const isLevel1 = path.length === level1Depth
  const badge = isLevel1 ? directReportLabel(node) : headcountLabel(node, showRollup)
  const tone = isProjectNode(node) ? 'project' : divisionTone(node.division ?? node.section)
  const selectedProjectIndex =
    projectEntries.length > 0 &&
    selectedPath.length === path.length + 1 &&
    isPathWithin(selectedPath, path)
      ? selectedPath[path.length]
      : null

  // A branch filter keeps the chosen teams. "This branch" still narrows the
  // selected line, but other chosen branches stay on the chart.
  const atBranchRow =
    path.length === branchParentPath.length && isPathWithin(path, branchParentPath)
  const shownChildren = spineEntries.filter(({ index }) => {
      if (branchKeys) {
        if (path.length < branchParentPath.length) {
          if (index !== branchParentPath[path.length]) return false
        } else if (atBranchRow && !branchKeys.has(pathKey([...path, index]))) {
          return false
        }
      }
      const leadsToSelection =
        isolate && path.length < selectedPath.length && isPathWithin(selectedPath, path)
      if (leadsToSelection && !(branchKeys && atBranchRow) && index !== selectedPath[path.length]) {
        return false
      }
      return true
    })
  const hiddenPeers = spineEntries.length - shownChildren.length
  // Balu sits with the L1 row. Top shows only the CEO and the operating lead,
  // and closing the CEO hides Balu with the rest of that team.
  const l1Open = spineEntries.some(({ index }) => expanded.has(pathKey([...path, index])))
  const visibleSide = isOpen
    ? sideEntries.filter(({ index }) => l1Open || expanded.has(pathKey([...path, index])))
    : []
  const peerIndexes = [...visibleSide, ...shownChildren]
    .sort((left, right) => left.index - right.index)
    .map(({ index }) => index)
  // Arrange this node's children as a rectangular grid when they are the L2
  // layer. A single leftover child (e.g. while isolating a branch) falls back
  // to the standard column so the rectangle does not look like a stray box.
  const useRectGrid = path.length === gridDepth && shownChildren.length > 1
  const gridCols = useRectGrid ? rectangularColumns(shownChildren.length) : undefined

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const index = path[path.length - 1] ?? 0
    let destination: OrgPath | null = null
    if (event.key === 'ArrowUp' && path.length > 0) destination = parentPath(path)
    const shownPosition = siblingIndexes.indexOf(index)
    if (event.key === 'ArrowDown' && hasChildren && shownChildren.length > 0) {
      destination = [...path, shownChildren[0].index]
    }
    if (event.key === 'ArrowLeft' && shownPosition > 0) {
      destination = [...path.slice(0, -1), siblingIndexes[shownPosition - 1]]
    }
    if (event.key === 'ArrowRight' && shownPosition >= 0 && shownPosition < siblingIndexes.length - 1) {
      destination = [...path.slice(0, -1), siblingIndexes[shownPosition + 1]]
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
        className={`org-box org-box-main division-${tone} ${selected ? 'is-selected' : ''} ${onTrail ? 'is-trail' : ''} ${isProjectNode(node) ? 'is-project' : ''} ${inlineProjects ? 'has-inline-projects' : ''}`}
        aria-expanded={hasChildren ? isOpen : undefined}
        onClick={() => onSelect(path)}
        onKeyDown={onKeyDown}
      >
        <span className="org-box-body">
          
          <span className="org-box-name">{node.name}</span>
          <span className="org-box-title">{node.designation}</span>
          {inlineProjects ? (
            <>
              <span className="org-box-meta">
                <span className="org-box-projects">
                  {projectCount} {projectCount === 1 ? 'project' : 'projects'}
                </span>
                {badge ? <span className="org-box-badge">{badge}</span> : null}
              </span>
              <ManagerProjectList
                projects={projectEntries.map(({ child }) => child)}
                indexes={projectEntries.map(({ index }) => index)}
                variant="chart"
                selectedIndex={selectedProjectIndex}
                onSelectProject={(index) => onSelect([...path, index])}
              />
            </>
          ) : badge ? (
            <span className="org-box-meta">
              <span className="org-box-badge">{badge}</span>
            </span>
          ) : null}
        </span>
      </button>

      {visibleSide.map(({ child, index }) => (
        <div className="org-side" key={pathKey([...path, index])}>
          <span className="org-side-link" aria-hidden="true">
            <span className="org-side-link-h" />
            <span className="org-side-link-v" />
          </span>
          <ChartBox
            node={child}
            path={[...path, index]}
            selectedPath={selectedPath}
            expanded={expanded}
            showRollup={showRollup}
            onSelect={onSelect}
            siblingIndexes={peerIndexes}
            isolate={isolate}
            branchParentPath={branchParentPath}
            branchKeys={branchKeys}
            gridDepth={path.length + 1}
            level1Depth={path.length + 1}
          />
        </div>
      ))}

      {isOpen && hiddenPeers > 0 ? (
        <p className="org-hidden-note">
          {hiddenPeers} peer {hiddenPeers === 1 ? 'branch' : 'branches'} hidden
        </p>
      ) : null}

      {isOpen ? (
        <div
          className={`org-kids ${useRectGrid ? 'is-grid' : ''}`}
          role="group"
          style={useRectGrid ? ({ '--l2-cols': gridCols } as CSSProperties) : undefined}
        >
          {shownChildren.map(({ child, index }) => (
            <div className="org-branch" key={pathKey([...path, index])}>
              <ChartBox
                node={child}
                path={[...path, index]}
                selectedPath={selectedPath}
                expanded={expanded}
                showRollup={showRollup}
                onSelect={onSelect}
                siblingIndexes={sideEntries.length > 0 ? peerIndexes : shownChildren.map(({ index: childIndex }) => childIndex)}
                isolate={isolate}
                branchParentPath={branchParentPath}
                branchKeys={branchKeys}
                gridDepth={gridDepth}
                level1Depth={level1Depth}
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
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(keysToDepth(root, leadershipOffset(root) + 1)),
  )
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
  const [branchKeys, setBranchKeys] = useState<Set<string> | null>(null)
  const [dockOpen, setDockOpen] = useState(false)
  const [showPopup, setShowPopup] = useState(true)
  const [profileOpen, setProfileOpen] = useState(false)
  const [previewPath, setPreviewPath] = useState<OrgPath>([])
  const [profileAt, setProfileAt] = useState<{ top: number; left: number } | null>(null)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const profileOpenRef = useRef(false)
  const showPopupRef = useRef(true)
  const skipRevealRef = useRef(false)
  const exportDialogRef = useRef(false)
  const exportingRef = useRef(false)
  const [levelPreset, setLevelPreset] = useState<number | 'all' | null>(1)
  const [exporting, setExporting] = useState<'image' | 'pdf' | null>(null)
  const [exportKind, setExportKind] = useState<'image' | 'pdf' | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  exportDialogRef.current = exportKind !== null
  const levelsId = useId()
  const zoomId = useId()
  const branchesId = useId()
  const dockPanelId = useId()

  const activeFocusPath = focusPath && isPathWithin(selectedPath, focusPath) ? focusPath : null
  const chartRoot = activeFocusPath ? getFocusedNode(root, activeFocusPath) : root
  const chartRootPath = activeFocusPath ?? []
  // The rectangular L2 grid should appear beneath each L1 leader. From the
  // true root that means depth = leadershipOffset + 1 (skipping the CEO →
  // operating-lead chain); from a focused subtree it is simply one below the
  // focus, matching how the L1/L2 dock buttons compute their depths.
  const l1PathLength =
    chartRootPath.length + (chartRootPath.length === 0 ? leadershipOffset(chartRoot) : 0) + 1
  const level1Depth = leadershipOffset(root) + 1
  const chartRootKey = pathKey(chartRootPath)
  const branches = useMemo(
    () => listChartBranches(chartRoot, pathFromKey(chartRootKey)),
    [chartRoot, chartRootKey],
  )
  const teamBranches = branches.filter((branch) => branch.node.layout !== 'side')
  const branchParentPath = (teamBranches[0] ?? branches[0])
    ? (teamBranches[0] ?? branches[0]).path.slice(0, -1)
    : chartRootPath
  const branchFilterKey = branchKeys ? [...branchKeys].sort().join('|') : ''

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
      const target = event.target
      if (target instanceof Element && target.closest('.export-dialog-backdrop')) {
        return
      }
      if (!dockRef.current?.contains(target as Node)) {
        setDockOpen(false)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !profileOpen && !exportDialogRef.current) {
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
    if (isolate || exportingRef.current) {
      return
    }
    const visible = deepestVisiblePath(selectedPath, expanded)
    if (pathKey(visible) !== pathKey(selectedPath)) {
      onSelect(visible)
    }
  }, [expanded, isolate, selectedPath, onSelect])

  // If the open person sits in a branch that was switched off, move to one
  // that is still on the chart.
  useEffect(() => {
    if (!branchKeys || exportingRef.current) {
      return
    }
    const catalog = listChartBranches(chartRoot, pathFromKey(chartRootKey))
    const branchDepth = catalog[0]?.path.length ?? 0
    if (selectedPath.length < branchDepth) {
      return
    }
    const match = catalog.find((branch) => isPathWithin(selectedPath, branch.path))
    if (match && branchKeys.has(pathKey(match.path))) {
      return
    }
    const fallback = catalog.find((branch) => branchKeys.has(pathKey(branch.path)))
    if (fallback && pathKey(fallback.path) !== pathKey(selectedPath)) {
      skipRevealRef.current = true
      onSelect(fallback.path)
    }
  }, [branchKeys, selectedPath, chartRoot, chartRootKey, onSelect])

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
    if (!showPopupRef.current) {
      return
    }
    clearHoverTimers()
    if (profileOpenRef.current) {
      showPreview(path)
      return
    }
    openTimer.current = window.setTimeout(() => showPreview(path), HOVER_OPEN_MS)
  }

  useEffect(() => {
    showPopupRef.current = showPopup
    if (!showPopup) {
      clearHoverTimers()
      hidePreview()
    }
  }, [showPopup])

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
      if (!showPopupRef.current || window.matchMedia('(hover: hover)').matches) {
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

  // Place Balu left of the stem between the CEO and Ramesh, and drop the
  // level-1 row when his own report would cover those cards. Spacing is inline
  // so the PDF snapshot keeps the same gaps after the chart is cloned.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const readZoom = () => {
      const raw = getComputedStyle(canvas).zoom
      const value = Number.parseFloat(raw)
      if (!Number.isFinite(value) || value <= 0) {
        return 1
      }
      return raw.includes('%') ? value / 100 : value
    }

    const readPx = (element: HTMLElement, name: string, fallback: number) => {
      const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name))
      return Number.isFinite(value) ? value : fallback
    }

    const sharesColumn = (above: DOMRect, below: DOMRect) =>
      above.left < below.right - 1 && above.right > below.left + 1

    const pushBelow = (above: DOMRect, below: DOMRect, zoomFactor: number, cardGap: number) => {
      if (!sharesColumn(above, below)) {
        return 0
      }
      return Math.max(0, (above.bottom + cardGap * zoomFactor - below.top) / zoomFactor)
    }

    const place = () => {
      const node = canvas.querySelector<HTMLElement>(':scope > .org-node')
      const side = node?.querySelector<HTMLElement>(':scope > .org-side') ?? null
      const ceo = node?.querySelector<HTMLElement>(':scope > .org-box') ?? null
      const ceoKids = node?.querySelector<HTMLElement>(':scope > .org-kids') ?? null
      const levelKids = node?.querySelector<HTMLElement>(
        ':scope > .org-kids > .org-branch > .org-node > .org-kids',
      )
      node?.style.removeProperty('padding-left')
      if (!node || !side || !ceo || !ceoKids) {
        ceoKids?.style.removeProperty('padding-top')
        ceoKids?.style.removeProperty('--kids-stem')
        levelKids?.style.removeProperty('padding-top')
        levelKids?.style.removeProperty('--kids-stem')
        return
      }

      const zoomFactor = readZoom()
      const stem = readPx(node, '--stem', 18)
      const gap = readPx(node, '--side-gap', 36)
      const cardHeight = readPx(node, '--leader-card-height', 122)
      const cardGap = 24
      const sideCard = side.querySelector<HTMLElement>(':scope > .org-node > .org-box')
      const cardWidth = sideCard ? sideCard.getBoundingClientRect().width / zoomFactor : 188

      const setKidsGap = (kids: HTMLElement, padding: number) => {
        kids.style.paddingTop = `${padding}px`
        kids.style.setProperty('--kids-stem', `${padding}px`)
      }

      setKidsGap(ceoKids, cardHeight + stem * 2)
      if (levelKids) {
        setKidsGap(levelKids, stem)
      }

      const origin = node.getBoundingClientRect()
      const local = (element: HTMLElement) => {
        const box = element.getBoundingClientRect()
        return {
          top: (box.top - origin.top) / zoomFactor,
          left: (box.left - origin.left) / zoomFactor,
          width: box.width / zoomFactor,
          height: box.height / zoomFactor,
        }
      }
      const ceoBox = local(ceo)
      let baluLeft = ceoBox.left - gap - cardWidth
      const baluTop = ceoBox.top + ceoBox.height + stem * 2

      const applySide = (left: number) => {
        side.style.top = `${baluTop}px`
        side.style.left = `${left}px`
        const placed = side.getBoundingClientRect()
        const baluCenter = (placed.left - origin.left) / zoomFactor + placed.width / zoomFactor / 2
        const ceoMid = ceoBox.top + ceoBox.height / 2
        const link = side.querySelector<HTMLElement>('.org-side-link')
        if (link) {
          link.style.width = `${Math.max(ceoBox.left - baluCenter, 0) + 1}px`
          link.style.height = `${Math.max(baluTop - ceoMid, 0)}px`
        }
      }
      applySide(baluLeft)

      const operating = node.querySelector<HTMLElement>(
        ':scope > .org-kids > .org-branch > .org-node > .org-box',
      )
      if (operating) {
        const lead = operating.getBoundingClientRect()
        const sideBox = side.getBoundingClientRect()
        const overlap = sideBox.right + gap * zoomFactor - lead.left
        if (overlap > 1) {
          baluLeft -= overlap / zoomFactor
          applySide(baluLeft)
        }
      }

      const sideCards = () => [...side.querySelectorAll<HTMLElement>('.org-box')]
      const levelCards = () =>
        levelKids ? [...levelKids.querySelectorAll<HTMLElement>('.org-box')] : []

      const leadPush = () => {
        if (!operating) {
          return 0
        }
        const lead = operating.getBoundingClientRect()
        return sideCards().reduce(
          (space, card) => Math.max(space, pushBelow(card.getBoundingClientRect(), lead, zoomFactor, cardGap)),
          0,
        )
      }
      const reportPush = () =>
        levelCards().reduce((space, card) => {
          const box = card.getBoundingClientRect()
          return sideCards().reduce(
            (inner, blocker) =>
              Math.max(inner, pushBelow(blocker.getBoundingClientRect(), box, zoomFactor, cardGap)),
            space,
          )
        }, 0)

      const leadExtra = leadPush()
      if (leadExtra > 0) {
        setKidsGap(ceoKids, cardHeight + stem * 2 + Math.ceil(leadExtra))
      }
      const reportExtra = reportPush()
      if (levelKids && reportExtra > 0) {
        setKidsGap(levelKids, stem + Math.ceil(reportExtra))
      }

      const leadAgain = leadPush()
      if (leadAgain > 0.5) {
        const current = Number.parseFloat(ceoKids.style.paddingTop) || 0
        setKidsGap(ceoKids, current + Math.ceil(leadAgain))
      }
      const reportAgain = reportPush()
      if (levelKids && reportAgain > 0.5) {
        const current = Number.parseFloat(levelKids.style.paddingTop) || 0
        setKidsGap(levelKids, current + Math.ceil(reportAgain))
      }
    }

    place()
    canvas.addEventListener('chart-relayout', place)
    return () => canvas.removeEventListener('chart-relayout', place)
  }, [chartRoot, expanded, compact, isolate, selectedPath, branchFilterKey, zoom, exporting])

  // Direct reports of each L1 leader share one card height, taken from the
  // tallest card in that group. Other levels keep their own sizes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    function equalizeLevelOneReports() {
      canvas?.querySelectorAll<HTMLElement>('.org-kids.is-grid').forEach((grid) => {
        const boxes = Array.from(
          grid.querySelectorAll<HTMLElement>(':scope > .org-branch > .org-node > .org-box'),
        )
        if (boxes.length < 2) {
          boxes.forEach((box) => {
            box.style.height = ''
          })
          return
        }
        boxes.forEach((box) => {
          box.style.height = 'auto'
        })
        const height = boxes.reduce((tallest, box) => Math.max(tallest, box.offsetHeight), 0)
        boxes.forEach((box) => {
          box.style.height = `${height}px`
        })
      })
    }

    equalizeLevelOneReports()
    canvas?.dispatchEvent(new Event('chart-relayout'))
    window.addEventListener('resize', equalizeLevelOneReports)
    return () => window.removeEventListener('resize', equalizeLevelOneReports)
  }, [chartRoot, expanded, compact, isolate, selectedPath, branchFilterKey])

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
    setBranchKeys(null)
    setLevelPreset(depth)
    skipRevealRef.current = true
    if (depth === 'all') {
      setExpanded(new Set(expandableKeys(chartRoot, chartRootPath)))
      return
    }
    const offset = chartRootPath.length === 0 ? leadershipOffset(chartRoot) : 0
    const nextExpanded = new Set(keysToDepth(chartRoot, chartRootPath.length + offset + depth, chartRootPath))
    setExpanded(nextExpanded)
    let clipped = selectedPath.slice(0, offset + depth)
    const clippedNode = getNodeAtPath(root, clipped)
    if (clippedNode?.layout === 'side' && !nextExpanded.has(pathKey(clipped))) {
      const parent = getNodeAtPath(root, clipped.slice(0, -1))
      const spineIndex = parent?.children.findIndex((child) => child.layout !== 'side' && !isProjectNode(child)) ?? -1
      if (spineIndex >= 0) {
        clipped = [...clipped.slice(0, -1), spineIndex]
      }
    }
    setRevealedKey(pathKey(clipped))
    if (pathKey(clipped) !== pathKey(selectedPath)) {
      onSelect(clipped)
    }
  }

  function toggleBranch(branchPath: OrgPath) {
    const key = pathKey(branchPath)
    const allKeys = branches.map((branch) => pathKey(branch.path))
    const next = new Set(branchKeys ?? allKeys)
    const removing = next.has(key)
    if (removing) {
      next.delete(key)
    } else {
      next.add(key)
    }

    setLevelPreset(null)
    if (removing && next.size === 0) {
      return
    }
    if (next.size === allKeys.length) {
      setBranchKeys(null)
      return
    }

    setBranchKeys(next)
    setExpanded((current) => {
      const expandedNext = new Set(current)
      ancestorKeys(branchPath).forEach((ancestor) => expandedNext.add(ancestor))
      if (!removing) {
        expandedNext.add(key)
      }
      return expandedNext
    })

    if (removing && isPathWithin(selectedPath, branchPath)) {
      setIsolate(false)
      const fallback = branches.find((branch) => next.has(pathKey(branch.path)))
      if (fallback) {
        // Keep the next visible team at its current depth. Selecting it would
        // otherwise open that leader's reports.
        skipRevealRef.current = true
        onSelect(fallback.path)
      }
    }
  }

  function expandedForDepth(depth: Exclude<PageDepth, 'current'>): Set<string> {
    const offset = chartRootPath.length === 0 ? leadershipOffset(chartRoot) : 0
    return new Set(keysToDepth(chartRoot, chartRootPath.length + offset + depth, chartRootPath))
  }

  function waitForPaint(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  }

  async function confirmExport(setup: ChartExportSetup) {
    const canvas = canvasRef.current
    if (!canvas || !exportKind || exportingRef.current) {
      return
    }
    const kind = exportKind
    setProfileOpen(false)
    flushSync(() => {
      setExporting(kind)
    })
    exportingRef.current = true
    const previous = {
      branchKeys,
      isolate,
      expanded,
      levelPreset,
    }
    try {
      if (kind === 'image') {
        setExportNote('Preparing image…')
        await waitForPaint()
        await downloadChartImage(canvas, setup)
        setExportKind(null)
        return
      }

      const images: HTMLCanvasElement[] = []
      for (let index = 0; index < setup.pages.length; index += 1) {
        const page = setup.pages[index]
        setExportNote(`Preparing page ${index + 1} of ${setup.pages.length}…`)
        const showAllTeams = page.branchKeys.length === 0 || page.branchKeys.length >= branches.length
        const pageExpanded = page.depth === 'current' ? new Set(previous.expanded) : expandedForDepth(page.depth)
        if (page.depth !== 0) {
          page.branchKeys.forEach((key) => {
            ancestorKeys(pathFromKey(key)).forEach((ancestor) => pageExpanded.add(ancestor))
          })
        }
        flushSync(() => {
          setIsolate(false)
          setBranchKeys(showAllTeams ? null : new Set(page.branchKeys))
          setExpanded(pageExpanded)
        })
        await waitForPaint()
        const shot = await captureChartCanvas(canvas)
        images.push(placeChartOnPaper(shot, setup.size, setup.orientation))
      }
      setExportNote('Saving PDF…')
      await downloadChartPdf(images, setup)
      setExportKind(null)
    } catch {
      window.alert('Could not download the chart. Try again.')
    } finally {
      exportingRef.current = false
      flushSync(() => {
        setBranchKeys(previous.branchKeys)
        setIsolate(previous.isolate)
        setExpanded(previous.expanded)
        setLevelPreset(previous.levelPreset)
      })
      setExporting(null)
      setExportNote(null)
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
          <button
            type="button"
            className="chip"
            onClick={() => {
              setFocusPath(null)
              setBranchKeys(null)
              setIsolate(false)
            }}
          >
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
            siblingIndexes={[chartRootPath[chartRootPath.length - 1] ?? 0]}
            isolate={isolate}
            branchParentPath={branchParentPath}
            branchKeys={branchKeys}
            gridDepth={l1PathLength}
            level1Depth={level1Depth}
          />
        </div>
      </div>
      <p className="sr-only">
        Hover a person to see their details. Click to expand or collapse their reports. Use arrow keys to move: up to
        the manager, down to the first report, left and right between peers.
      </p>

      {showPopup && profileOpen && previewNode && profileAt ? (
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
            countScope={previewPath.length === level1Depth ? 'direct' : 'rollup'}
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

            {branches.length > 1 ? (
              <section className="dock-block">
                <div className="dock-row">
                  <p className="dock-title" id={`${branchesId}-label`}>
                    Branches
                  </p>
                  {branchKeys ? (
                    <button
                      type="button"
                      className="dock-fit"
                      onClick={() => {
                        setBranchKeys(null)
                        setIsolate(false)
                      }}
                    >
                      All
                    </button>
                  ) : (
                    <span className="dock-zoom-value">{branches.length}</span>
                  )}
                </div>
                <p className="dock-hint">Select one or more teams</p>
                <div className="dock-branches" role="group" aria-labelledby={`${branchesId}-label`}>
                  {branches.map((branch) => {
                    const key = pathKey(branch.path)
                    const checked = !branchKeys || branchKeys.has(key)
                    return (
                      <label key={key} className="dock-branch" title={branch.node.name}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBranch(branch.path)}
                        />
                        <span>{branch.node.name}</span>
                      </label>
                    )
                  })}
                </div>
              </section>
            ) : null}

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
                    const next = !isolate
                    setIsolate(next)
                    if (!next) {
                      setBranchKeys((current) => {
                        if (!current || current.size !== 1) {
                          return current
                        }
                        const only = [...current][0]
                        const currentBranch = branches.find((branch) => isPathWithin(selectedPath, branch.path))
                        return currentBranch && pathKey(currentBranch.path) === only ? null : current
                      })
                      return
                    }
                    setLevelPreset(null)
                    setExpanded(new Set([...ancestorKeys(selectedPath), pathKey(selectedPath)]))
                    const currentBranch = branches.find((branch) => isPathWithin(selectedPath, branch.path))
                    if (currentBranch && branches.length > 1) {
                      setBranchKeys(new Set([pathKey(currentBranch.path)]))
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
              <div className="dock-switch">
                <span>Pop-up</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showPopup}
                  className={showPopup ? 'is-on' : undefined}
                  title="Show the profile pop-up on hover"
                  onClick={() => setShowPopup(!showPopup)}
                />
              </div>
              {!activeFocusPath && selectedPath.length > 0 ? (
                <button
                  type="button"
                  className="dock-action"
                  title="Make this person the top"
                  onClick={() => {
                    setFocusPath(selectedPath)
                    setBranchKeys(null)
                    setIsolate(false)
                    setExpanded((current) => new Set(current).add(pathKey(selectedPath)))
                  }}
                >
                  Start from here
                </button>
              ) : null}
            </section>

            <section className="dock-block">
              <p className="dock-title">Download</p>
              <p className="dock-hint">Size, layout, and pages</p>
              <div className="dock-levels" role="group" aria-label="Download chart">
                <button type="button" disabled={exporting !== null} onClick={() => setExportKind('image')}>
                  {exporting === 'image' ? 'Saving…' : 'Image'}
                </button>
                <button type="button" disabled={exporting !== null} onClick={() => setExportKind('pdf')}>
                  {exporting === 'pdf' ? 'Saving…' : 'PDF'}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
      {exportKind ? (
        <ExportDialog
          key={exportKind}
          kind={exportKind}
          branches={branches.map((branch) => ({ key: pathKey(branch.path), name: branch.node.name }))}
          busy={exporting !== null}
          status={exportNote}
          onClose={() => {
            if (!exportingRef.current) {
              setExportKind(null)
            }
          }}
          onConfirm={(setup) => void confirmExport(setup)}
        />
      ) : null}
    </section>
  )
}

function listChartBranches(node: OrgNode, basePath: OrgPath): { node: OrgNode; path: OrgPath }[] {
  const offset = basePath.length === 0 ? leadershipOffset(node) : 0
  const side = node.children
    .map((child, index) => ({ node: child, path: [...basePath, index] }))
    .filter((branch) => branch.node.layout === 'side')
  let parent = node
  let path = basePath
  for (let step = 0; step < offset; step += 1) {
    const nextIndex = parent.children.findIndex((child) => !isProjectNode(child) && child.layout !== 'side')
    const next = nextIndex >= 0 ? parent.children[nextIndex] : undefined
    if (!next) {
      return side
    }
    parent = next
    path = [...path, nextIndex]
  }
  const teams = parent.children
    .map((child, index) => ({ node: child, path: [...path, index] }))
    .filter((branch) => !isProjectNode(branch.node) && branch.node.layout !== 'side')
  return [...side, ...teams]
}

function getFocusedNode(root: OrgNode, path: OrgPath): OrgNode {
  let current = root
  for (const index of path) {
    current = current.children[index] ?? current
  }
  return current
}
