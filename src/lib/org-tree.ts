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

export function headcountLabel(node: OrgNode, showRollup: boolean): string | null {
  const rolled = rollupHeadcount(node)
  const own = node.count

  if (showRollup) {
    if (rolled <= 0) {
      return null
    }
    const body = `${formatPeople(rolled)} total`
    return node.section ? `${node.section} · ${body}` : body
  }

  if (node.section && own != null) {
    return `${node.section} · ${formatPeople(own)}`
  }

  return null
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
    node.children.forEach((child, index) => {
      walk(child, [...path, index], [...ancestors, node.name])
    })
  }

  walk(root, [], [])
  return hits
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
      let score = 0
      if (name === q) score = 100
      else if (name.startsWith(q)) score = 80
      else if (name.includes(q)) score = 60
      else if (title.includes(q)) score = 30
      else return null
      return { hit, score }
    })
    .filter((entry): entry is { hit: SearchHit; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.hit.node.name.localeCompare(b.hit.node.name))

  return scored.slice(0, limit).map((entry) => entry.hit)
}
