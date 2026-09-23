import { isOrgNode, type OrgNode } from '../types/org'

export async function loadOrgData(): Promise<OrgNode> {
  const response = await fetch('/org-data.json', { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`Unable to load organisation data (${response.status}).`)
  }

  const payload: unknown = await response.json()
  if (!isOrgNode(payload)) {
    throw new Error('org-data.json does not match the expected node shape.')
  }

  return payload
}
