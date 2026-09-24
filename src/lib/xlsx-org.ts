import { unzipSync } from 'fflate'
import type { OrgNode } from '../types/org'

const REQUIRED_HEADERS = [
  'Username',
  'Name',
  'Email',
  'Designation',
  'Status',
  'Manager',
  'Division',
  'Department',
  'Department Category',
  'Project Name',
  'Last Working Day',
  'TSM',
] as const

type Header = (typeof REQUIRED_HEADERS)[number]
type Row = Record<Header, string>

export type WorkbookOrgData = {
  root: OrgNode
  employeeCount: number
  warnings: string[]
}

function parseXml(bytes: Uint8Array, filename: string): XMLDocument {
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml')
  if (document.querySelector('parsererror')) {
    throw new Error(`${filename} is not valid XML.`)
  }
  return document
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? ''
  let index = 0
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64
  }
  return index - 1
}

function zipPath(target: string): string {
  const normalized = target.replaceAll('\\', '/').replace(/^\/+/, '')
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized}`
}

function cellText(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute('t')
  if (type === 'inlineStr') {
    return Array.from(cell.getElementsByTagName('t'))
      .map((part) => part.textContent ?? '')
      .join('')
  }

  const raw = cell.getElementsByTagName('v')[0]?.textContent ?? ''
  if (type === 's') {
    return sharedStrings[Number(raw)] ?? ''
  }
  if (type === 'b') {
    return raw === '1' ? 'TRUE' : 'FALSE'
  }
  return raw
}

function readRows(buffer: ArrayBuffer): string[][] {
  const files = unzipSync(new Uint8Array(buffer))
  const workbookBytes = files['xl/workbook.xml']
  const relationshipsBytes = files['xl/_rels/workbook.xml.rels']
  if (!workbookBytes || !relationshipsBytes) {
    throw new Error('The workbook structure is incomplete.')
  }

  const workbook = parseXml(workbookBytes, 'workbook.xml')
  const relationships = parseXml(relationshipsBytes, 'workbook relationships')
  const sheet =
    Array.from(workbook.getElementsByTagName('sheet')).find(
      (item) => item.getAttribute('name')?.trim().toLowerCase() === 'pmo report',
    ) ?? workbook.getElementsByTagName('sheet')[0]
  if (!sheet) {
    throw new Error('The workbook does not contain a worksheet.')
  }

  const relationshipId = sheet.getAttribute('r:id')
  const relationship = Array.from(relationships.getElementsByTagName('Relationship')).find(
    (item) => item.getAttribute('Id') === relationshipId,
  )
  const target = relationship?.getAttribute('Target')
  const worksheetBytes = target ? files[zipPath(target)] : undefined
  if (!worksheetBytes) {
    throw new Error(`Unable to read worksheet "${sheet.getAttribute('name') ?? 'Sheet 1'}".`)
  }

  const sharedStringsBytes = files['xl/sharedStrings.xml']
  const sharedStrings = sharedStringsBytes
    ? Array.from(parseXml(sharedStringsBytes, 'sharedStrings.xml').getElementsByTagName('si')).map((item) =>
        Array.from(item.getElementsByTagName('t'))
          .map((part) => part.textContent ?? '')
          .join(''),
      )
    : []

  const worksheet = parseXml(worksheetBytes, 'worksheet')
  return Array.from(worksheet.getElementsByTagName('row')).map((row) => {
    const values: string[] = []
    Array.from(row.getElementsByTagName('c')).forEach((cell) => {
      const index = columnIndex(cell.getAttribute('r') ?? '')
      if (index >= 0) {
        values[index] = cellText(cell, sharedStrings).trim()
      }
    })
    return values
  })
}

function valueOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' || /^(n\/?a|null)$/i.test(trimmed) ? undefined : trimmed
}

function excelDate(value: string): string | undefined {
  const present = valueOrUndefined(value)
  if (!present) return undefined
  if (!/^\d+(?:\.\d+)?$/.test(present)) return present

  const serial = Number(present)
  if (serial < 1 || serial > 2958465) return present
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000)
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function key(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function toNode(row: Row): OrgNode {
  const division = valueOrUndefined(row.Division)
  return {
    username: valueOrUndefined(row.Username),
    name: row.Name.trim(),
    email: valueOrUndefined(row.Email),
    designation: valueOrUndefined(row.Designation) ?? 'Designation not provided',
    status: valueOrUndefined(row.Status),
    manager: valueOrUndefined(row.Manager),
    division,
    department: valueOrUndefined(row.Department),
    departmentCategory: valueOrUndefined(row['Department Category']),
    projectName: valueOrUndefined(row['Project Name']),
    lastWorkingDay: excelDate(row['Last Working Day']),
    tsm: valueOrUndefined(row.TSM),
    section: division ?? null,
    count: 1,
    children: [],
  }
}

export function workbookToOrg(buffer: ArrayBuffer): WorkbookOrgData {
  const values = readRows(buffer)
  if (values.length === 0) {
    throw new Error('The workbook is empty.')
  }

  const headers = values[0].map((header) => header.trim())
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header))
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}.`)
  }

  const rows = values
    .slice(1)
    .map((valuesRow) =>
      Object.fromEntries(
        REQUIRED_HEADERS.map((header) => [header, valuesRow[headers.indexOf(header)]?.trim() ?? '']),
      ) as Row,
    )
    .filter((row) => row.Name !== '')

  if (rows.length === 0) {
    throw new Error('The workbook has no employees with a Name.')
  }

  const warnings: string[] = []
  const nodes = rows.map(toNode)
  const indicesByName = new Map<string, number[]>()
  rows.forEach((row, index) => {
    const list = indicesByName.get(key(row.Name)) ?? []
    list.push(index)
    indicesByName.set(key(row.Name), list)
  })

  const duplicateNames = Array.from(indicesByName.values()).filter((indices) => indices.length > 1)
  if (duplicateNames.length > 0) {
    warnings.push(
      `${duplicateNames.length} duplicate employee name${duplicateNames.length === 1 ? '' : 's'} found; employee IDs remain distinct.`,
    )
  }

  const parents = new Map<number, number>()
  const unmatchedManagers = new Set<string>()
  const ambiguousManagers = new Set<string>()

  rows.forEach((row, index) => {
    const manager = valueOrUndefined(row.Manager)
    if (!manager) return
    const matches = indicesByName.get(key(manager)) ?? []
    if (matches.length === 1 && matches[0] !== index) {
      parents.set(index, matches[0])
    } else if (matches.length === 0) {
      unmatchedManagers.add(manager)
    } else {
      ambiguousManagers.add(manager)
    }
  })

  if (unmatchedManagers.size > 0) {
    warnings.push(
      `${unmatchedManagers.size} manager name${unmatchedManagers.size === 1 ? '' : 's'} not found in the employee rows.`,
    )
  }
  if (ambiguousManagers.size > 0) {
    warnings.push(
      `${ambiguousManagers.size} manager name${ambiguousManagers.size === 1 ? '' : 's'} could not be matched uniquely.`,
    )
  }

  const cycleMembers = new Set<number>()
  nodes.forEach((_, start) => {
    const seen = new Set<number>()
    let current: number | undefined = start
    while (current !== undefined && !seen.has(current)) {
      seen.add(current)
      current = parents.get(current)
    }
    if (current !== undefined) {
      cycleMembers.add(current)
      parents.delete(current)
    }
  })
  if (cycleMembers.size > 0) {
    warnings.push(`${cycleMembers.size} circular reporting relationship${cycleMembers.size === 1 ? '' : 's'} was detached.`)
  }

  nodes.forEach((node, index) => {
    const parent = parents.get(index)
    if (parent !== undefined) nodes[parent].children.push(node)
  })
  nodes.forEach((node) => node.children.sort((a, b) => a.name.localeCompare(b.name)))

  const roots = nodes.filter((_, index) => !parents.has(index)).sort((a, b) => a.name.localeCompare(b.name))
  const root =
    roots.length === 1
      ? roots[0]
      : {
          name: 'Organisation',
          designation: `${roots.length} top-level reporting lines`,
          section: null,
          count: 0,
          children: roots,
        }

  if (roots.length > 1) {
    warnings.push(`${roots.length} top-level reporting lines are grouped under an Organisation node.`)
  }

  return { root, employeeCount: rows.length, warnings }
}
