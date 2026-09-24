export const SECTIONS = ['IT', 'BPO'] as const

export type OrgSection = (typeof SECTIONS)[number]

export type OrgNode = {
  username?: string
  name: string
  email?: string
  designation: string
  status?: string
  manager?: string
  division?: string
  department?: string
  departmentCategory?: string
  projectName?: string
  lastWorkingDay?: string
  tsm?: string
  section: string | null
  count: number | null
  children: OrgNode[]
}

export type OrgPath = number[]

export type SearchHit = {
  path: OrgPath
  node: OrgNode
  ancestors: string[]
}

export function isOrgNode(value: unknown): value is OrgNode {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (typeof candidate.name !== 'string' || candidate.name.trim() === '') {
    return false
  }
  if (typeof candidate.designation !== 'string' || candidate.designation.trim() === '') {
    return false
  }
  if (candidate.section !== null && typeof candidate.section !== 'string') {
    return false
  }
  if (candidate.count !== null && (typeof candidate.count !== 'number' || !Number.isFinite(candidate.count))) {
    return false
  }
  if (!Array.isArray(candidate.children)) {
    return false
  }
  return candidate.children.every(isOrgNode)
}
