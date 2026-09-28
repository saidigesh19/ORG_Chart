import { unzipSync } from 'fflate'
import type { OrgNode } from '../types/org'
import { namesLikelyMatch, prepareOrgTree, type PivotByPerson } from './org-tree'

type FieldKey =
  | 'username'
  | 'name'
  | 'email'
  | 'designation'
  | 'status'
  | 'manager'
  | 'division'
  | 'department'
  | 'departmentCategory'
  | 'projectName'
  | 'lastWorkingDay'
  | 'tsm'
  | 'employmentType'
  | 'dateOfJoining'
  | 'l2Manager'
  | 'management'
  | 'ceo'

type EmployeeRow = Record<FieldKey, string>

const FIELD_ALIASES: Record<FieldKey, string[]> = {
  username: ['username', 'employee id', 'employeeid', 'emp id'],
  name: ['name', 'employee name'],
  email: ['email'],
  designation: ['designation', 'title'],
  status: ['status'],
  manager: ['manager', 'l1 manager', 'reporting manager', 'reporting to'],
  division: ['division'],
  department: ['department'],
  departmentCategory: ['department category', 'dept category'],
  projectName: ['project name', 'project'],
  lastWorkingDay: ['last working day', 'lwd'],
  tsm: ['tsm'],
  employmentType: ['employment type'],
  dateOfJoining: ['date of joining', 'doj'],
  l2Manager: ['business head l2 manager', 'l2 manager'],
  management: ['management'],
  ceo: ['ceo'],
}

const PLACEHOLDER_MANAGER = /^(uKnowva System|n\/?a|null|-)$/i

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

function normalizeHeader(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

function readSheetRows(worksheetBytes: Uint8Array, sharedStrings: string[]): string[][] {
  const worksheet = parseXml(worksheetBytes, 'worksheet')
  return Array.from(worksheet.getElementsByTagName('row')).map((row) => {
    const values: string[] = []
    Array.from(row.getElementsByTagName('c')).forEach((cell) => {
      const index = columnIndex(cell.getAttribute('r') ?? '')
      if (index >= 0) {
        values[index] = cellText(cell, sharedStrings).replace(/\u00a0/g, ' ').trim()
      }
    })
    return values
  })
}

function readWorkbookSheets(buffer: ArrayBuffer): { name: string; rows: string[][] }[] {
  const files = unzipSync(new Uint8Array(buffer))
  const workbookBytes = files['xl/workbook.xml']
  const relationshipsBytes = files['xl/_rels/workbook.xml.rels']
  if (!workbookBytes || !relationshipsBytes) {
    throw new Error('The workbook structure is incomplete.')
  }

  const workbook = parseXml(workbookBytes, 'workbook.xml')
  const relationships = parseXml(relationshipsBytes, 'workbook relationships')
  const sharedStringsBytes = files['xl/sharedStrings.xml']
  const sharedStrings = sharedStringsBytes
    ? Array.from(parseXml(sharedStringsBytes, 'sharedStrings.xml').getElementsByTagName('si')).map((item) =>
        Array.from(item.getElementsByTagName('t'))
          .map((part) => part.textContent ?? '')
          .join(''),
      )
    : []

  return Array.from(workbook.getElementsByTagName('sheet')).flatMap((sheet) => {
    const name = sheet.getAttribute('name')?.trim() || 'Sheet'
    const relationshipId = sheet.getAttribute('r:id')
    const relationship = Array.from(relationships.getElementsByTagName('Relationship')).find(
      (item) => item.getAttribute('Id') === relationshipId,
    )
    const target = relationship?.getAttribute('Target')
    const worksheetBytes = target ? files[zipPath(target)] : undefined
    if (!worksheetBytes) {
      return []
    }
    return [{ name, rows: readSheetRows(worksheetBytes, sharedStrings) }]
  })
}

function isEmployeeSheet(rows: string[][]): boolean {
  if (rows.length < 2) {
    return false
  }
  const headers = rows[0].map((header) => normalizeHeader(header ?? ''))
  const hasName = headers.includes('name') || headers.includes('employee name')
  const hasIdentity = headers.includes('username') || headers.includes('designation') || headers.includes('employee id')
  const looksLikePivot = headers.includes('row labels') || headers.some((header) => header.startsWith('count of'))
  return hasName && hasIdentity && !looksLikePivot
}

function columnIndexFor(headers: string[], aliases: string[]): number {
  const normalized = headers.map((header) => normalizeHeader(header ?? ''))
  for (const alias of aliases) {
    const index = normalized.indexOf(alias)
    if (index >= 0) {
      return index
    }
  }
  return -1
}

function valueOrUndefined(value: string): string | undefined {
  const trimmed = value.replace(/\u00a0/g, ' ').trim()
  return trimmed === '' || /^(n\/?a|null|-)$/i.test(trimmed) ? undefined : trimmed
}

function formatDate(value: string): string | undefined {
  const present = valueOrUndefined(value)
  if (!present) {
    return undefined
  }

  const iso = present.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`)
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    }
  }

  if (!/^\d+(?:\.\d+)?$/.test(present)) {
    return present
  }

  const serial = Number(present)
  if (serial < 1 || serial > 2958465) {
    return present
  }
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000)
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function key(value: string): string {
  return value.replace(/\u00a0/g, ' ').trim().toLocaleLowerCase()
}

function parseEmployeeSheet(rows: string[][]): EmployeeRow[] {
  const headers = rows[0]
  const indexes = Object.fromEntries(
    (Object.keys(FIELD_ALIASES) as FieldKey[]).map((field) => [field, columnIndexFor(headers, FIELD_ALIASES[field])]),
  ) as Record<FieldKey, number>

  if (indexes.name < 0) {
    return []
  }

  return rows
    .slice(1)
    .map((values) => {
      const read = (field: FieldKey) => {
        const index = indexes[field]
        return index >= 0 ? (values[index] ?? '').trim() : ''
      }
      return {
        username: read('username'),
        name: read('name'),
        email: read('email'),
        designation: read('designation'),
        status: read('status'),
        manager: read('manager'),
        division: read('division'),
        department: read('department'),
        departmentCategory: read('departmentCategory'),
        projectName: read('projectName'),
        lastWorkingDay: read('lastWorkingDay'),
        tsm: read('tsm'),
        employmentType: read('employmentType'),
        dateOfJoining: read('dateOfJoining'),
        l2Manager: read('l2Manager'),
        management: read('management'),
        ceo: read('ceo'),
      }
    })
    .filter((row) => row.name !== '')
}

function collectEmployeeRows(sheets: { name: string; rows: string[][] }[]): { rows: EmployeeRow[]; usedSheets: string[] } {
  const usedSheets: string[] = []
  const seen = new Set<string>()
  const rows: EmployeeRow[] = []

  for (const sheet of sheets) {
    if (!isEmployeeSheet(sheet.rows)) {
      continue
    }
    const parsed = parseEmployeeSheet(sheet.rows)
    if (parsed.length === 0) {
      continue
    }
    usedSheets.push(sheet.name)
    parsed.forEach((row) => {
      const id = key(row.username || row.name)
      if (seen.has(id)) {
        return
      }
      seen.add(id)
      rows.push(row)
    })
  }

  return { rows, usedSheets }
}

function toNode(row: EmployeeRow): OrgNode {
  const division = valueOrUndefined(row.division)
  return {
    username: valueOrUndefined(row.username),
    name: row.name.trim(),
    email: valueOrUndefined(row.email),
    designation: valueOrUndefined(row.designation) ?? 'Designation not provided',
    status: valueOrUndefined(row.status),
    manager: valueOrUndefined(row.manager),
    division,
    department: valueOrUndefined(row.department),
    departmentCategory: valueOrUndefined(row.departmentCategory),
    projectName: valueOrUndefined(row.projectName),
    lastWorkingDay: formatDate(row.lastWorkingDay),
    tsm: valueOrUndefined(row.tsm),
    employmentType: valueOrUndefined(row.employmentType),
    dateOfJoining: formatDate(row.dateOfJoining),
    l2Manager: valueOrUndefined(row.l2Manager),
    section: division ?? null,
    count: 1,
    children: [],
  }
}

function firstLabel(row: string[]): string {
  return row.find((cell) => (cell ?? '').trim() !== '')?.trim() ?? ''
}

function isNumericCell(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value.trim())
}

function looksLikeCountSheet(rows: string[][]): boolean {
  const headers = rows.slice(0, 6).flat().map((cell) => normalizeHeader(cell ?? ''))
  return headers.some((header) => header === 'row labels' || header.startsWith('count of') || header === 'grand total')
}

function parseCountGroups(rows: string[][], knownName: (name: string) => boolean): PivotByPerson {
  const groups: PivotByPerson = new Map()
  let current: string | null = null

  for (const row of rows) {
    const label = firstLabel(row)
    if (!label) {
      continue
    }
    if (/^(row labels|column labels|grand total|count of)/i.test(label)) {
      if (/^grand total$/i.test(label)) {
        current = null
      }
      continue
    }

    const numbers = row.filter((cell) => isNumericCell(cell))
    if (knownName(label) && numbers.length > 0) {
      current = label
      if (!groups.has(current)) {
        groups.set(current, [])
      }
      continue
    }

    if (current && numbers.length > 0) {
      const projects = groups.get(current) ?? []
      const count = Number(numbers[0])
      if (Number.isFinite(count) && !projects.some((item) => namesLikelyMatch(item.name, label))) {
        projects.push({ name: label, count })
        groups.set(current, projects)
      }
    }
  }

  return groups
}

function mergePivot(target: PivotByPerson, extra: PivotByPerson) {
  extra.forEach((projects, person) => {
    const current = target.get(person) ?? []
    projects.forEach((project) => {
      if (!current.some((item) => namesLikelyMatch(item.name, project.name))) {
        current.push(project)
      }
    })
    target.set(person, current)
  })
}

type MappingBranch = { lead: string; reports: string[] }

type OrgMapping = {
  rootName?: string
  branches: MappingBranch[]
}

function parseMapping(rows: string[][]): OrgMapping | null {
  const compact = rows.map((row) => row.map((cell) => (cell ?? '').trim())).filter((row) => row.some((cell) => cell !== ''))

  let rootName: string | undefined
  let leads: string[] = []
  const reports: string[][] = []
  let sawLeads = false

  for (const row of compact) {
    const texts = row.filter((cell) => cell !== '' && !isNumericCell(cell) && !/^(ceo|grand total)$/i.test(cell))
    const numbers = row.filter((cell) => isNumericCell(cell))
    if (texts.length === 0) {
      continue
    }
    if (numbers.length > 0 && sawLeads) {
      break
    }
    if (!sawLeads && texts.length === 1 && !rootName) {
      rootName = texts[0]
      continue
    }
    if (!sawLeads && texts.length >= 3) {
      leads = texts
      sawLeads = true
      continue
    }
    if (sawLeads) {
      reports.push(row)
    }
  }

  if (leads.length === 0) {
    return null
  }

  return {
    rootName,
    branches: leads.map((lead, index) => ({
      lead,
      reports: reports.map((row) => row[index]?.trim() ?? '').filter((name) => name !== '' && !isNumericCell(name)),
    })),
  }
}

function findNamedNode(nodes: OrgNode[], name: string): OrgNode | undefined {
  return nodes.find((node) => namesLikelyMatch(node.name, name))
}

function applyMapping(nodes: OrgNode[], mapping: OrgMapping, warnings: string[]) {
  function ensure(name: string): OrgNode {
    const existing = findNamedNode(nodes, name)
    if (existing) {
      return existing
    }
    const stub: OrgNode = {
      name,
      designation: 'Listed in Mapping',
      section: null,
      count: 0,
      children: [],
    }
    nodes.push(stub)
    warnings.push(`${name} was added from the Mapping sheet.`)
    return stub
  }

  function detach(child: OrgNode) {
    nodes.forEach((node) => {
      const index = node.children.indexOf(child)
      if (index >= 0) {
        node.children.splice(index, 1)
      }
    })
  }

  const root = (mapping.rootName ? ensure(mapping.rootName) : nodes.find((node) => node.children.length > 0)) ?? nodes[0]
  if (!root) {
    return
  }

  mapping.branches.forEach((branch) => {
    const lead = ensure(branch.lead)
    if (lead !== root && !root.children.includes(lead)) {
      detach(lead)
      root.children.push(lead)
    }
    branch.reports.forEach((reportName) => {
      const report = ensure(reportName)
      if (report === lead || report === root) {
        return
      }
      detach(report)
      if (!lead.children.includes(report)) {
        lead.children.push(report)
      }
    })
  })

  const leadOrder = mapping.branches.map((branch) => branch.lead)
  root.children.sort((a, b) => {
    const left = leadOrder.findIndex((name) => namesLikelyMatch(name, a.name))
    const right = leadOrder.findIndex((name) => namesLikelyMatch(name, b.name))
    if (left === -1 && right === -1) {
      return a.name.localeCompare(b.name)
    }
    if (left === -1) {
      return 1
    }
    if (right === -1) {
      return -1
    }
    return left - right
  })

  mapping.branches.forEach((branch) => {
    const lead = findNamedNode(nodes, branch.lead)
    if (!lead) {
      return
    }
    lead.children.sort((a, b) => {
      const left = branch.reports.findIndex((name) => namesLikelyMatch(name, a.name))
      const right = branch.reports.findIndex((name) => namesLikelyMatch(name, b.name))
      if (left === -1 && right === -1) {
        return a.name.localeCompare(b.name)
      }
      if (left === -1) {
        return 1
      }
      if (right === -1) {
        return -1
      }
      return left - right
    })
  })

  function collectPeople(node: OrgNode, list: OrgNode[] = []): OrgNode[] {
    node.children.forEach((child) => {
      if (child.kind !== 'project') {
        list.push(child)
        collectPeople(child, list)
      }
    })
    return list
  }

  function majority(values: Array<string | undefined>): string | undefined {
    const counts = new Map<string, number>()
    values.forEach((value) => {
      if (!value) {
        return
      }
      counts.set(value, (counts.get(value) ?? 0) + 1)
    })
    let best: string | undefined
    let highest = 0
    counts.forEach((count, value) => {
      if (count > highest) {
        best = value
        highest = count
      }
    })
    return best
  }

  nodes.forEach((node) => {
    const team = collectPeople(node)
    if (team.length === 0) {
      return
    }
    if (!node.division && !node.section) {
      const division = majority(team.map((person) => person.division ?? person.section ?? undefined))
      if (division) {
        node.division = division
        node.section = division
      }
    }
    if (!node.departmentCategory) {
      node.departmentCategory = majority(team.map((person) => person.departmentCategory))
    }
    if (node.designation === 'Listed in Mapping') {
      node.designation =
        majority(team.map((person) => person.departmentCategory)) ??
        majority(team.map((person) => person.designation)) ??
        node.designation
    }
  })
}

function usableManager(value: string | undefined, selfName: string): string | undefined {
  const manager = valueOrUndefined(value ?? '')
  if (!manager || PLACEHOLDER_MANAGER.test(manager) || key(manager) === key(selfName)) {
    return undefined
  }
  return manager
}

export function workbookToOrg(buffer: ArrayBuffer): WorkbookOrgData {
  const sheets = readWorkbookSheets(buffer)
  if (sheets.length === 0) {
    throw new Error('The workbook does not contain a worksheet.')
  }

  const { rows, usedSheets } = collectEmployeeRows(sheets)
  if (rows.length === 0) {
    const names = sheets.map((sheet) => sheet.name).join(', ')
    throw new Error(`No employee sheet found. Workbook sheets: ${names}.`)
  }

  const warnings: string[] = []
  warnings.push(`Employee rows were read from ${usedSheets.join(', ')}.`)

  const nodes = rows.map(toNode)
  const indicesByName = new Map<string, number[]>()
  rows.forEach((row, index) => {
    const list = indicesByName.get(key(row.name)) ?? []
    list.push(index)
    indicesByName.set(key(row.name), list)
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
    const candidates = [row.manager, row.l2Manager, row.management]
    let firstMissing: string | undefined
    for (const candidate of candidates) {
      const manager = usableManager(candidate, row.name)
      if (!manager) {
        continue
      }
      const matches = indicesByName.get(key(manager)) ?? []
      if (matches.length === 1 && matches[0] !== index) {
        parents.set(index, matches[0])
        return
      }
      if (matches.length === 0) {
        firstMissing ??= manager
        continue
      }
      ambiguousManagers.add(manager)
    }
    if (firstMissing && !parents.has(index)) {
      unmatchedManagers.add(firstMissing)
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
    if (parent !== undefined) {
      nodes[parent].children.push(node)
    }
  })

  const knownName = (name: string) =>
    nodes.some((node) => namesLikelyMatch(node.name, name)) ||
    rows.some((row) => namesLikelyMatch(row.name, name))

  const pivot: PivotByPerson = new Map()
  sheets.forEach((sheet) => {
    if (looksLikeCountSheet(sheet.rows) || /pivot/i.test(sheet.name)) {
      mergePivot(pivot, parseCountGroups(sheet.rows, knownName))
      warnings.push(`Project counts were read from ${sheet.name}.`)
    }
  })

  const mappingSheet = sheets.find((sheet) => /map/i.test(sheet.name))
  const mapping = mappingSheet ? parseMapping(mappingSheet.rows) : null
  if (mapping) {
    applyMapping(nodes, mapping, warnings)
    warnings.push(`L1/L2 layout was read from ${mappingSheet?.name}.`)
    mergePivot(pivot, parseCountGroups(mappingSheet?.rows ?? [], knownName))
  }

  const roots = nodes.filter((node) => !nodes.some((parent) => parent.children.includes(node)))
  let businessRoot =
    roots.length === 1
      ? roots[0]
      : {
          name: 'Organisation',
          designation: `${roots.length} top-level reporting lines`,
          section: null,
          count: 0,
          children: roots,
        }

  const ceoName = valueOrUndefined(rows.find((row) => row.ceo)?.ceo ?? '')
  let extraTop = 0
  if (ceoName && !namesLikelyMatch(businessRoot.name, ceoName)) {
    businessRoot = {
      name: ceoName,
      designation: 'CEO',
      division: 'Management',
      departmentCategory: 'Management',
      section: 'Management',
      count: 1,
      children: [businessRoot],
    }
    extraTop = 1
    warnings.push(`${ceoName} was placed at the top as CEO.`)
  }

  const root = prepareOrgTree(
    businessRoot,
    pivot.size > 0 ? pivot : undefined,
    Boolean(mapping) || extraTop > 0,
    2 + extraTop,
  )

  if (roots.length > 1) {
    warnings.push(`${roots.length} top-level reporting lines are grouped under an Organisation node.`)
  }

  return { root, employeeCount: rows.length, warnings }
}
