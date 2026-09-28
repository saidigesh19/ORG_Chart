import { isOrgNode, type OrgNode } from '../types/org'
import { prepareOrgTree } from './org-tree'
import { workbookToOrg } from './xlsx-org'

export type LoadedOrgData = {
  root: OrgNode
  employeeCount: number | null
  source: 'Excel' | 'sample JSON'
  warnings: string[]
}

const WORKBOOK_PATH = '/Org Chart Data V2.xlsx'

function isExcelBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) {
    return false
  }
  const bytes = new Uint8Array(buffer, 0, 2)
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

export async function loadOrgData(): Promise<LoadedOrgData> {
  let workbookProblem: string | null = null

  try {
    const workbookResponse = await fetch(encodeURI(WORKBOOK_PATH), { cache: 'no-store' })
    if (workbookResponse.ok) {
      const buffer = await workbookResponse.arrayBuffer()
      if (isExcelBuffer(buffer)) {
        const loaded = workbookToOrg(buffer)
        return { ...loaded, source: 'Excel' }
      }
      workbookProblem = 'Org Chart Data V2.xlsx is not a valid Excel file.'
    } else if (workbookResponse.status !== 404) {
      workbookProblem = `Org Chart Data V2.xlsx could not be loaded (${workbookResponse.status}).`
    } else {
      workbookProblem = 'Org Chart Data V2.xlsx was not found in public.'
    }
  } catch (reason: unknown) {
    workbookProblem = reason instanceof Error ? reason.message : 'Org Chart Data V2.xlsx could not be read.'
  }

  const jsonResponse = await fetch('/org-data.json', { cache: 'no-cache' })
  if (!jsonResponse.ok) {
    throw new Error(workbookProblem ?? `Unable to load organisation data (${jsonResponse.status}).`)
  }

  const payload: unknown = await jsonResponse.json()
  if (!isOrgNode(payload)) {
    throw new Error('org-data.json does not match the expected node shape.')
  }

  return {
    root: prepareOrgTree(payload),
    employeeCount: null,
    source: 'sample JSON',
    warnings: workbookProblem ? [`Excel fallback: ${workbookProblem}`] : [],
  }
}
