// Builds the org tree the same way `src/lib/xlsx-org.ts` does and prints
// the direct children of any name you pass on the CLI (default: Ramki).
//
// Usage: node scripts/verify-tree.mjs [name-substring]

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

const target = (process.argv[2] ?? 'Ramakrishna Rao Bodi').toLowerCase()
const file = resolve('public/Org Chart Data V2.xlsx')
const buffer = readFileSync(file)
const zip = unzipSync(new Uint8Array(buffer))

// ---------- xlsx plumbing ------------------------------------------------
function decode(bytes) {
  return strFromU8(bytes)
}
function decodeEntity(v) {
  return v
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}
function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? ''
  let n = 0
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64
  return n - 1
}
const sharedStrings = []
if (zip['xl/sharedStrings.xml']) {
  const xml = decode(zip['xl/sharedStrings.xml'])
  for (const item of xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    sharedStrings.push([...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''))
  }
}
const workbookXml = decode(zip['xl/workbook.xml'])
const relsXml = decode(zip['xl/_rels/workbook.xml.rels'])
const rels = {}
for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) rels[m[1]] = m[2]
const sheets = []
for (const m of workbookXml.matchAll(/<sheet\b([^/]+)\/>/g)) {
  const attrs = m[1]
  const name = /name="([^"]+)"/.exec(attrs)?.[1] ?? 'Sheet'
  const rid = /r:id="([^"]+)"/.exec(attrs)?.[1]
  const target = rels[rid]
  if (!target) continue
  const path = target.startsWith('xl/') ? target : `xl/${target.replace(/^\/+/, '')}`
  sheets.push({ name, path })
}
function readSheet(path) {
  const xml = decode(zip[path])
  const rows = []
  for (const rm of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const rowXml = rm[0]
    const values = []
    for (const c of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^/]*)\/>/g)) {
      const attrs = c[1] ?? c[3] ?? ''
      const inner = c[2] ?? ''
      const ref = /r="([^"]+)"/.exec(attrs)?.[1] ?? ''
      const t = /t="([^"]+)"/.exec(attrs)?.[1]
      let text = ''
      if (t === 'inlineStr') {
        text = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''
        if (t === 's') text = sharedStrings[Number(v)] ?? ''
        else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE'
        else text = v
      }
      text = decodeEntity(text).replace(/\u00a0/g, ' ').trim()
      const idx = columnIndex(ref)
      if (idx >= 0) values[idx] = text
    }
    rows.push(values)
  }
  return rows
}
const parsed = sheets.map((s) => ({ name: s.name, rows: readSheet(s.path) }))

// ---------- name matching (mirror of org-tree.ts) -----------------------
function nameTokens(v) {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}
function levenshtein(a, b) {
  if (a === b) return 0
  const prev = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let j = 1; j <= b.length; j += 1) {
    let last = prev[0]
    prev[0] = j
    for (let i = 1; i <= a.length; i += 1) {
      const next = prev[i]
      prev[i] = a[i - 1] === b[j - 1] ? last : 1 + Math.min(last, prev[i], prev[i - 1])
      last = next
    }
  }
  return prev[a.length]
}
function namesLikelyMatch(a, b) {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  if (left === right) return true
  const lt = nameTokens(a)
  const rt = nameTokens(b)
  if (lt.length === 0 || rt.length === 0) return false
  if (lt.length === rt.length) {
    return lt.every((tok, i) => {
      const o = rt[i]
      return tok === o || tok.startsWith(o) || o.startsWith(tok) || levenshtein(tok, o) <= 2
    })
  }
  return levenshtein(lt.join(''), rt.join('')) <= 2
}

// ---------- employee sheet parsing --------------------------------------
const FIELD_ALIASES = {
  username: ['username', 'employee id', 'employeeid', 'emp id'],
  name: ['name', 'employee name'],
  manager: ['manager', 'l1 manager', 'reporting manager', 'reporting to'],
  l2Manager: ['business head l2 manager', 'l2 manager'],
  management: ['management'],
  ceo: ['ceo'],
}
function normalizeHeader(v) {
  return (v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}
function isEmployeeSheet(rows) {
  if (rows.length < 2) return false
  const h = rows[0].map(normalizeHeader)
  const hasName = h.includes('name') || h.includes('employee name')
  const hasIdentity = h.includes('username') || h.includes('designation') || h.includes('employee id')
  const looksPivot = h.includes('row labels') || h.some((x) => x.startsWith('count of'))
  return hasName && hasIdentity && !looksPivot
}
function columnIndexFor(headers, aliases) {
  const norm = headers.map(normalizeHeader)
  for (const a of aliases) {
    const i = norm.indexOf(a)
    if (i >= 0) return i
  }
  return -1
}
function key(v) {
  return (v ?? '').replace(/\u00a0/g, ' ').trim().toLowerCase()
}
function valueOrUndefined(v) {
  const t = (v ?? '').replace(/\u00a0/g, ' ').trim()
  return t === '' || /^(n\/?a|null|-)$/i.test(t) ? undefined : t
}
const PLACEHOLDER = /^(uKnowva System|n\/?a|null|-)$/i

const rows = []
const seen = new Set()
for (const s of parsed) {
  if (!isEmployeeSheet(s.rows)) continue
  const headers = s.rows[0]
  const idx = {}
  for (const f of Object.keys(FIELD_ALIASES)) idx[f] = columnIndexFor(headers, FIELD_ALIASES[f])
  if (idx.name < 0) continue
  for (const r of s.rows.slice(1)) {
    const read = (f) => (idx[f] >= 0 ? (r[idx[f]] ?? '').trim() : '')
    const row = {
      username: read('username'),
      name: read('name'),
      manager: read('manager'),
      l2Manager: read('l2Manager'),
      management: read('management'),
      ceo: read('ceo'),
    }
    if (!row.name) continue
    const id = key(row.username || row.name)
    if (seen.has(id)) continue
    seen.add(id)
    rows.push(row)
  }
}

// ---------- initial manager tree ----------------------------------------
const nodes = rows.map((r) => ({ name: r.name, children: [] }))
const indicesByName = new Map()
rows.forEach((r, i) => {
  const list = indicesByName.get(key(r.name)) ?? []
  list.push(i)
  indicesByName.set(key(r.name), list)
})
function usableManager(v, self) {
  const m = valueOrUndefined(v)
  if (!m || PLACEHOLDER.test(m) || key(m) === key(self)) return undefined
  return m
}
const parents = new Map()
rows.forEach((r, i) => {
  const cands = [r.manager, r.l2Manager, r.management]
  for (const c of cands) {
    const m = usableManager(c, r.name)
    if (!m) continue
    const hits = indicesByName.get(key(m)) ?? []
    if (hits.length === 1 && hits[0] !== i) {
      parents.set(i, hits[0])
      return
    }
  }
})
// cycle break
nodes.forEach((_, start) => {
  const s = new Set()
  let cur = start
  while (cur !== undefined && !s.has(cur)) {
    s.add(cur)
    cur = parents.get(cur)
  }
  if (cur !== undefined) parents.delete(cur)
})
nodes.forEach((n, i) => {
  const p = parents.get(i)
  if (p !== undefined) nodes[p].children.push(n)
})

// ---------- mapping ------------------------------------------------------
function isNumericCell(v) {
  return /^-?\d+(?:\.\d+)?$/.test((v ?? '').trim())
}
function parseMapping(rows) {
  const trimmed = rows.map((r) => r.map((c) => (c ?? '').trim()))
  let rootName
  let leadRow = -1
  const leadByCol = new Map()
  for (let i = 0; i < trimmed.length; i += 1) {
    const row = trimmed[i]
    const texts = row.filter((c) => c !== '' && !isNumericCell(c) && !/^(ceo|grand total)$/i.test(c))
    if (texts.length === 0) continue
    if (texts.length === 1 && !rootName && leadRow === -1) {
      rootName = texts[0]
      continue
    }
    if (texts.length >= 3 && leadRow === -1) {
      row.forEach((cell, col) => {
        if (cell && !isNumericCell(cell) && !/^(ceo|grand total)$/i.test(cell)) leadByCol.set(col, cell)
      })
      leadRow = i
      break
    }
  }
  if (leadByCol.size === 0) return null
  function isSummary(row) {
    const ne = row.filter((c) => c !== '')
    if (ne.length < 2) return false
    const fi = row.findIndex((c) => c !== '')
    if (fi < 0 || isNumericCell(row[fi])) return false
    return ne.slice(1).every((c) => isNumericCell(c))
  }
  const repByCol = new Map()
  for (let i = leadRow + 1; i < trimmed.length; i += 1) {
    const row = trimmed[i]
    if (row.some((c) => /^grand total$/i.test(c))) break
    if (isSummary(row)) break
    for (const [col] of leadByCol) {
      const cell = row[col]
      if (!cell || isNumericCell(cell) || /^(ceo|grand total)$/i.test(cell)) continue
      const list = repByCol.get(col) ?? []
      list.push(cell)
      repByCol.set(col, list)
    }
  }
  return {
    rootName,
    branches: [...leadByCol.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([col, lead]) => ({ lead, reports: repByCol.get(col) ?? [] })),
  }
}

const mapSheet = parsed.find((s) => /map/i.test(s.name))
const mapping = mapSheet ? parseMapping(mapSheet.rows) : null

// ---------- applyMapping (mirror of xlsx-org.ts) ------------------------
function findNamedNode(list, name) {
  return list.find((n) => namesLikelyMatch(n.name, name))
}
function applyMapping(nodes, mapping, ceoName) {
  function ensure(name) {
    const existing = findNamedNode(nodes, name)
    if (existing) {
      if (existing.name.trim().toLowerCase() !== name.trim().toLowerCase()) existing.name = name
      return existing
    }
    const stub = { name, designation: 'Listed in Mapping', children: [], _stub: true }
    nodes.push(stub)
    return stub
  }
  function detach(child) {
    nodes.forEach((n) => {
      const i = n.children.indexOf(child)
      if (i >= 0) n.children.splice(i, 1)
    })
  }
  let root
  if (mapping.rootName) {
    root = ensure(mapping.rootName)
  } else if (ceoName) {
    root = ensure(ceoName)
    if (!root.designation || root.designation === 'Listed in Mapping') root.designation = 'CEO'
    detach(root)
  } else {
    const structuralRoots = nodes.filter((n) => !nodes.some((p) => p.children.includes(n)))
    root = structuralRoots.length === 1 ? structuralRoots[0] : (nodes.find((n) => n.children.length > 0) ?? nodes[0])
  }
  if (!root) return
  mapping.branches.forEach((b) => {
    const lead = ensure(b.lead)
    if (lead !== root && !root.children.includes(lead)) {
      detach(lead)
      root.children.push(lead)
    }
    b.reports.forEach((rn) => {
      const rep = ensure(rn)
      if (rep === lead || rep === root) return
      detach(rep)
      if (!lead.children.includes(rep)) lead.children.push(rep)
    })
  })

  // Strict prune: each L1's direct reports are exactly the mapping L2 list.
  function dropSubtree(t) {
    t.children.slice().forEach(dropSubtree)
    t.children = []
    const i = nodes.indexOf(t)
    if (i >= 0) nodes.splice(i, 1)
  }
  mapping.branches.forEach((b) => {
    const lead = findNamedNode(nodes, b.lead)
    if (!lead) return
    const allowed = new Set()
    b.reports.forEach((rn) => {
      const rep = findNamedNode(nodes, rn)
      if (rep) allowed.add(rep)
    })
    const kept = []
    const dropped = []
    lead.children.forEach((c) => (allowed.has(c) ? kept.push(c) : dropped.push(c)))
    if (dropped.length > 0) {
      lead.children = kept
      dropped.forEach(dropSubtree)
    }
  })
}

const ceoName = valueOrUndefined(rows.find((r) => r.ceo)?.ceo ?? '')
if (mapping) applyMapping(nodes, mapping, ceoName)

// ---------- print --------------------------------------------------------
function printChildren(name) {
  const node = nodes.find((n) => n.name.toLowerCase().includes(name))
  if (!node) {
    console.log(`No node found matching "${name}".`)
    return
  }
  console.log(`\n=== Direct children of "${node.name}" (in the built tree) ===\n`)
  node.children.forEach((c, i) => console.log(`  ${i + 1}. ${c.name}`))
  console.log(`\nTotal: ${node.children.length}`)

  // Also cross-reference the mapping expectation
  const branch = mapping?.branches.find((b) => b.lead.toLowerCase().includes(name))
  if (!branch) return
  console.log(`\n=== Mapping sheet says these should be under "${branch.lead}" ===\n`)
  branch.reports.forEach((r, i) => console.log(`  ${i + 1}. ${r}`))
  console.log(`\nTotal: ${branch.reports.length}`)

  const expected = new Set(branch.reports.map((r) => r.toLowerCase()))
  const actual = new Set(node.children.map((c) => c.name.toLowerCase()))
  const extra = node.children.filter((c) => !expected.has(c.name.toLowerCase())).map((c) => c.name)
  const missing = branch.reports.filter((r) => !actual.has(r.toLowerCase()))
  console.log(`\n=== Extras currently under "${node.name}" that are NOT in the Mapping sheet ===\n`)
  if (extra.length === 0) console.log('  (none)')
  else extra.forEach((n, i) => console.log(`  ${i + 1}. ${n}`))
  console.log(`\n=== Missing from "${node.name}" that ARE in the Mapping sheet ===\n`)
  if (missing.length === 0) console.log('  (none)')
  else missing.forEach((n, i) => console.log(`  ${i + 1}. ${n}`))
}

printChildren(target)
