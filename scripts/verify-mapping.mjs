// Verifies that the L1 / L2 structure produced by `src/lib/xlsx-org.ts`
// matches the "Mapping" sheet in the workbook exactly.
//
// Usage: node scripts/verify-mapping.mjs [path-to-xlsx]

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

const file = resolve(process.argv[2] ?? 'public/Org Chart Data V2.xlsx')
const buffer = readFileSync(file)

const zip = unzipSync(new Uint8Array(buffer))

// --- shared strings ------------------------------------------------------
function decode(bytes) {
  return strFromU8(bytes)
}

const sharedStrings = []
if (zip['xl/sharedStrings.xml']) {
  const xml = decode(zip['xl/sharedStrings.xml'])
  const items = xml.match(/<si\b[\s\S]*?<\/si>/g) ?? []
  for (const item of items) {
    const parts = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1])
    sharedStrings.push(parts.join(''))
  }
}

// --- workbook -> sheet name / target -------------------------------------
const workbookXml = decode(zip['xl/workbook.xml'])
const relsXml = decode(zip['xl/_rels/workbook.xml.rels'])

const rels = {}
for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
  rels[m[1]] = m[2]
}

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

function readSheet(path) {
  const xml = decode(zip[path])
  const rows = []
  const rowMatches = xml.matchAll(/<row\b[\s\S]*?<\/row>/g)
  for (const rm of rowMatches) {
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

const parsedSheets = sheets.map((s) => ({ name: s.name, rows: readSheet(s.path) }))

// --- Mapping sheet: raw dump --------------------------------------------
const mapSheet = parsedSheets.find((s) => /map/i.test(s.name))
if (!mapSheet) {
  console.error('No sheet with "map" in name.')
  process.exit(1)
}

console.log(`\n=== Sheet: "${mapSheet.name}" (raw non-empty rows) ===\n`)
const maxCol = Math.max(...mapSheet.rows.map((r) => r.length))
for (let i = 0; i < mapSheet.rows.length; i += 1) {
  const row = mapSheet.rows[i]
  if (!row || !row.some((c) => (c ?? '').trim() !== '')) continue
  const padded = []
  for (let c = 0; c < maxCol; c += 1) padded.push((row[c] ?? '').trim())
  console.log(`R${String(i + 1).padStart(3, '0')}: [ ${padded.map((v) => JSON.stringify(v)).join(', ')} ]`)
}

// --- Reproduce parseMapping from src/lib/xlsx-org.ts ---------------------
function isNumericCell(v) {
  return /^-?\d+(?:\.\d+)?$/.test((v ?? '').trim())
}

function parseMapping(rows) {
  const trimmed = rows.map((r) => r.map((c) => (c ?? '').trim()))

  let rootName
  let leadRowIndex = -1
  const leadByColumn = new Map()

  for (let i = 0; i < trimmed.length; i += 1) {
    const row = trimmed[i]
    const texts = row.filter((c) => c !== '' && !isNumericCell(c) && !/^(ceo|grand total)$/i.test(c))
    if (texts.length === 0) continue
    if (texts.length === 1 && !rootName && leadRowIndex === -1) {
      rootName = texts[0]
      continue
    }
    if (texts.length >= 3 && leadRowIndex === -1) {
      row.forEach((cell, column) => {
        if (cell !== '' && !isNumericCell(cell) && !/^(ceo|grand total)$/i.test(cell)) {
          leadByColumn.set(column, cell)
        }
      })
      leadRowIndex = i
      break
    }
  }

  if (leadByColumn.size === 0) return null

  function isSummaryRow(row) {
    const nonEmpty = row.filter((c) => c !== '')
    if (nonEmpty.length < 2) return false
    const firstIdx = row.findIndex((c) => c !== '')
    if (firstIdx < 0 || isNumericCell(row[firstIdx])) return false
    return nonEmpty.slice(1).every((c) => isNumericCell(c))
  }

  const reportsByColumn = new Map()
  for (let i = leadRowIndex + 1; i < trimmed.length; i += 1) {
    const row = trimmed[i]
    if (row.some((c) => /^grand total$/i.test(c))) break
    if (isSummaryRow(row)) break
    for (const [column] of leadByColumn) {
      const cell = row[column]
      if (!cell || isNumericCell(cell) || /^(ceo|grand total)$/i.test(cell)) continue
      const list = reportsByColumn.get(column) ?? []
      list.push(cell)
      reportsByColumn.set(column, list)
    }
  }

  const branches = [...leadByColumn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([column, lead]) => ({ lead, reports: reportsByColumn.get(column) ?? [] }))

  return { rootName, branches }
}

const mapping = parseMapping(mapSheet.rows)

console.log('\n=== parseMapping() result (what the app uses to build L1/L2) ===\n')
if (!mapping) {
  console.log('(no mapping detected)')
} else {
  console.log(`rootName: ${JSON.stringify(mapping.rootName)}\n`)
  for (const b of mapping.branches) {
    console.log(`L1 = ${b.lead}`)
    for (const r of b.reports) console.log(`   L2 -> ${r}`)
    console.log('')
  }
}

// --- Also show what the mapping "should" be if we index by column pos ----
// This is what a human reader of the spreadsheet would expect.
function parseMappingByColumn(rows) {
  const compact = rows.map((r) => r.map((c) => (c ?? '').trim()))

  let rootName
  let leadRowIdx = -1
  let leadsByCol = new Map() // col index -> lead name

  for (let i = 0; i < compact.length; i += 1) {
    const row = compact[i]
    const texts = row.filter((c) => c !== '' && !isNumericCell(c) && !/^(ceo|grand total)$/i.test(c))
    if (texts.length === 0) continue
    if (texts.length === 1 && !rootName && leadRowIdx === -1) {
      rootName = texts[0]
      continue
    }
    if (texts.length >= 3 && leadRowIdx === -1) {
      row.forEach((cell, col) => {
        if (cell && !isNumericCell(cell) && !/^(ceo|grand total)$/i.test(cell)) {
          leadsByCol.set(col, cell)
        }
      })
      leadRowIdx = i
      break
    }
  }

  const branches = []
  for (const [col, lead] of leadsByCol) {
    const reports = []
    for (let i = leadRowIdx + 1; i < compact.length; i += 1) {
      const cell = compact[i][col]
      if (!cell) continue
      if (/^(grand total)$/i.test(cell)) break
      if (isNumericCell(cell)) continue
      reports.push(cell)
    }
    branches.push({ lead, col, reports })
  }

  return { rootName, branches }
}

const truthful = parseMappingByColumn(mapSheet.rows)
console.log('\n=== Column-indexed reading of the Mapping sheet (ground truth) ===\n')
console.log(`rootName: ${JSON.stringify(truthful.rootName)}\n`)
for (const b of truthful.branches) {
  console.log(`L1 = ${b.lead}  (column ${b.col})`)
  for (const r of b.reports) console.log(`   L2 -> ${r}`)
  console.log('')
}

// --- Diff -----------------------------------------------------------------
console.log('\n=== DIFF: parseMapping() vs column-indexed reading ===\n')

function key(v) {
  return v.trim().toLowerCase()
}

if (!mapping) {
  console.log('parseMapping() returned null; cannot compare.')
} else {
  const truthByLead = new Map(truthful.branches.map((b) => [key(b.lead), b.reports]))
  const parsedByLead = new Map(mapping.branches.map((b) => [key(b.lead), b.reports]))

  const leads = new Set([...truthByLead.keys(), ...parsedByLead.keys()])
  let mismatched = 0
  for (const l of leads) {
    const truthReports = truthByLead.get(l) ?? []
    const parsedReports = parsedByLead.get(l) ?? []
    const displayLead =
      truthful.branches.find((b) => key(b.lead) === l)?.lead ??
      mapping.branches.find((b) => key(b.lead) === l)?.lead ??
      l

    const t = truthReports.map(key).sort()
    const p = parsedReports.map(key).sort()
    const same = t.length === p.length && t.every((v, i) => v === p[i])
    if (!same) {
      mismatched += 1
      console.log(`MISMATCH under L1 "${displayLead}"`)
      const missingInParsed = truthReports.filter((r) => !parsedReports.some((x) => key(x) === key(r)))
      const extraInParsed = parsedReports.filter((r) => !truthReports.some((x) => key(x) === key(r)))
      if (missingInParsed.length) console.log(`   missing in app L2:  ${JSON.stringify(missingInParsed)}`)
      if (extraInParsed.length) console.log(`   extra in app L2:    ${JSON.stringify(extraInParsed)}`)
    }
  }
  if (mismatched === 0) {
    console.log('OK — the app`s L1/L2 exactly matches the Mapping sheet.')
  } else {
    console.log(`\n${mismatched} L1 branch(es) do not match the Mapping sheet.`)
  }
}
