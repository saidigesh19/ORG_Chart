import type { OrgNode, OrgPath, SearchHit } from '../types/org'

export function getNodeAtPath(root: OrgNode, path: OrgPath): OrgNode | null {
  let current = root
  for (const index of path) {
    const next = current.children[index]
    if (!next) {
      return null
    }
    current = next
  }
  return current
}

export function getTrail(root: OrgNode, path: OrgPath): { node: OrgNode; path: OrgPath }[] {
  const trail: { node: OrgNode; path: OrgPath }[] = [{ node: root, path: [] }]
  let current = root

  for (let i = 0; i < path.length; i += 1) {
    const next = current.children[path[i]]
    if (!next) {
      break
    }
    current = next
    trail.push({ node: current, path: path.slice(0, i + 1) })
  }

  return trail
}

export function parentPath(path: OrgPath): OrgPath {
  return path.slice(0, -1)
}

export function pathKey(path: OrgPath): string {
  return path.length === 0 ? 'root' : path.join('.')
}

export function isPathWithin(path: OrgPath, ancestor: OrgPath): boolean {
  return ancestor.length <= path.length && ancestor.every((index, position) => path[position] === index)
}

export function parseHashPath(hash: string): OrgPath | null {
  const raw = hash.replace(/^#/, '').replace(/^\/+/, '')
  if (raw === '') {
    return []
  }

  const parts = raw.split('/').filter(Boolean)
  const path: OrgPath = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null
    }
    path.push(Number(part))
  }
  return path
}

export function toHash(path: OrgPath): string {
  return path.length === 0 ? '#/' : `#/${path.join('/')}`
}

/**
 * Branch headcount. If a node declares a count that already covers its
 * descendants (typical for department totals), that figure is used.
 * If the declared count is smaller than the descendant sum, it is treated
 * as additional people on that node and added to the descendant total.
 */
export function rollupHeadcount(node: OrgNode): number {
  const descendantTotal = node.children.reduce((sum, child) => sum + rollupHeadcount(child), 0)
  if (node.username) {
    return 1 + descendantTotal
  }
  if (node.count == null) {
    return descendantTotal
  }
  if (descendantTotal === 0) {
    return node.count
  }
  if (node.count >= descendantTotal) {
    return node.count
  }
  return node.count + descendantTotal
}

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0 && !/^(de|van|von|da|del|la|le)$/i.test(part))

  if (parts.length === 0) {
    return '?'
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export function formatPeople(n: number): string {
  const rounded = Math.round(n)
  return `${rounded.toLocaleString('en-US')} ${rounded === 1 ? 'person' : 'people'}`
}

export type DivisionTone = 'technology' | 'operations' | 'corporate' | 'leadership' | 'neutral'

export function divisionTone(division?: string | null): DivisionTone {
  const value = division?.toLowerCase() ?? ''
  if (value.includes('it') || value.includes('tech')) return 'technology'
  if (value.includes('bpo') || value.includes('operations')) return 'operations'
  if (value.includes('support') || value.includes('finance')) return 'corporate'
  if (value.includes('management') || value.includes('leadership')) return 'leadership'
  return 'neutral'
}

export function headcountLabel(node: OrgNode, showRollup: boolean): string | null {
  if (!showRollup) {
    return null
  }

  const rolled = rollupHeadcount(node)
  if (rolled <= 0) {
    return null
  }

  return `${formatPeople(rolled)} total`
}

export function expandableKeys(node: OrgNode, path: OrgPath = [], keys: string[] = []): string[] {
  if (node.children.length > 0) {
    keys.push(pathKey(path))
    node.children.forEach((child, index) => expandableKeys(child, [...path, index], keys))
  }
  return keys
}

export function keysToDepth(node: OrgNode, maxDepth: number, path: OrgPath = [], keys: string[] = []): string[] {
  if (path.length < maxDepth && node.children.length > 0) {
    keys.push(pathKey(path))
    node.children.forEach((child, index) => keysToDepth(child, maxDepth, [...path, index], keys))
  }
  return keys
}

export function ancestorKeys(path: OrgPath): string[] {
  const keys: string[] = []
  for (let i = 0; i < path.length; i += 1) {
    keys.push(pathKey(path.slice(0, i)))
  }
  return keys
}

export function flattenSearchIndex(root: OrgNode): SearchHit[] {
  const hits: SearchHit[] = []

  function walk(node: OrgNode, path: OrgPath, ancestors: string[]) {
    hits.push({ path, node, ancestors })
    if (node.kind === 'project' && node.members) {
      node.members.forEach((member) => {
        hits.push({ path, node: member, ancestors: [...ancestors, node.name] })
      })
    }
    node.children.forEach((child, index) => {
      walk(child, [...path, index], [...ancestors, node.name])
    })
  }

  walk(root, [], [])
  return hits
}

export function isProjectNode(node: OrgNode): boolean {
  return node.kind === 'project'
}

export function hasProjectChildren(node: OrgNode): boolean {
  return node.children.length > 0 && node.children.every(isProjectNode)
}

export function orgGroupRank(node: OrgNode): number {
  const division = (node.division ?? node.section ?? '').trim().toLowerCase()
  const department = (node.department ?? '').trim().toLowerCase()
  const category = (node.departmentCategory ?? '').trim().toLowerCase()
  const blob = `${division} ${department} ${category}`

  if (division === 'it') {
    return 0
  }

  const itRelated =
    division.startsWith('it') ||
    /\bit\b/.test(division) ||
    department.startsWith('it') ||
    department.includes('infra') ||
    department.includes('staffing') ||
    department === 'engineering' ||
    (department === 'technical' && division !== 'bpo')

  if (itRelated) {
    return 1
  }

  if (division === 'bpo' || department.startsWith('operations-') || blob.includes('bpo')) {
    return 2
  }

  return 3
}

export function compareOrgSiblings(a: OrgNode, b: OrgNode): number {
  return orgGroupRank(a) - orgGroupRank(b) || a.name.localeCompare(b.name)
}

function majorityField(nodes: OrgNode[], pick: (node: OrgNode) => string | undefined): string | undefined {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    const value = pick(node)
    if (!value) {
      continue
    }
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  let best: string | undefined
  let highest = 0
  for (const [value, count] of counts) {
    if (count > highest) {
      best = value
      highest = count
    }
  }
  return best
}

function normalizeProjectName(value?: string): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || /^(n\/?a|null|unassigned|-)$/i.test(trimmed)) {
    return 'Unassigned'
  }
  return trimmed
}

function collectDescendants(node: OrgNode): OrgNode[] {
  const people: OrgNode[] = []
  function walk(current: OrgNode) {
    current.children.forEach((child) => {
      people.push(child)
      walk(child)
    })
  }
  walk(node)
  return people
}

function slimPerson(node: OrgNode): OrgNode {
  return { ...node, children: [], members: undefined }
}

function buildProjectNodes(manager: OrgNode): OrgNode[] {
  const groups = new Map<string, OrgNode[]>()
  collectDescendants(manager).forEach((person) => {
    const project = normalizeProjectName(person.projectName)
    const members = groups.get(project) ?? []
    members.push(slimPerson(person))
    groups.set(project, members)
  })

  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, members]) => {
      const division = majorityField(members, (member) => member.division)
      const department = majorityField(members, (member) => member.department)
      return {
        name,
        designation: members.length === 1 ? '1 person' : `${members.length} people`,
        division,
        department,
        departmentCategory: majorityField(members, (member) => member.departmentCategory),
        projectName: name === 'Unassigned' ? undefined : name,
        section: division ?? majorityField(members, (member) => member.section ?? undefined) ?? null,
        count: members.length,
        kind: 'project' as const,
        members,
        children: [],
      }
    })
}

function sortOrgChildren(node: OrgNode): OrgNode {
  node.children.sort(compareOrgSiblings)
  node.children.forEach(sortOrgChildren)
  return node
}

function replaceReportsWithProjects(node: OrgNode, depth: number): OrgNode {
  if (depth >= 2) {
    node.children = buildProjectNodes(node)
    return node
  }
  node.children.forEach((child) => replaceReportsWithProjects(child, depth + 1))
  return node
}

/** Sort IT → IT-related → BPO → Support/HR, and show projects under L2 instead of people. */
export function prepareOrgTree(root: OrgNode): OrgNode {
  return replaceReportsWithProjects(sortOrgChildren(root), 0)
}

export function searchPeople(index: SearchHit[], query: string, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) {
    return []
  }

  const scored = index
    .map((hit) => {
      const name = hit.node.name.toLowerCase()
      const title = hit.node.designation.toLowerCase()
      const metadata = [
        hit.node.username,
        hit.node.email,
        hit.node.division,
        hit.node.department,
        hit.node.departmentCategory,
        hit.node.projectName,
        hit.node.tsm,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      let score = 0
      if (name === q) score = 100
      else if (name.startsWith(q)) score = 80
      else if (name.includes(q)) score = 60
      else if (title.includes(q)) score = 30
      else if (metadata.includes(q)) score = 20
      else return null
      return { hit, score }
    })
    .filter((entry): entry is { hit: SearchHit; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.hit.node.name.localeCompare(b.hit.node.name))

  return scored.slice(0, limit).map((entry) => entry.hit)
}
