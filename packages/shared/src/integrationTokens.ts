export type IntegrationTokenScope = 'tasks:external'

export interface IntegrationTokenView {
  id: string
  projectId: string
  name: string
  scopes: IntegrationTokenScope[]
  createdAt: number
  lastUsedAt: number | null
}
