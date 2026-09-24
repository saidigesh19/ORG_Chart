import { isOrgNode, type OrgNode } from '../types/org'
import { workbookToOrg } from './xlsx-org'

export type LoadedOrgData = {
  root: OrgNode
  employeeCount: number | null
  source: 'Excel' | 'sample JSON'
  warnings: string[]
}

export async function loadOrgData(): Promise<LoadedOrgData> {
  let workbookProblem: string | null = null

  try {
    const workbookResponse = await fetch('/org-data.xlsx', { cache: 'no-cache' })
    if (workbookResponse.ok) {
      const loaded = workbookToOrg(await workbookResponse.arrayBuffer())
      return { ...loaded, source: 'Excel' }
    }
    if (workbookResponse.status !== 404) {
      workbookProblem = `org-data.xlsx could not be loaded (${workbookResponse.status}).`
    }
  } catch (reason: unknown) {
    workbookProblem = reason instanceof Error ? reason.message : 'org-data.xlsx could not be read.'
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
    root: payload,
    employeeCount: null,
    source: 'sample JSON',
    warnings: workbookProblem ? [`Excel fallback: ${workbookProblem}`] : [],
  }
}
