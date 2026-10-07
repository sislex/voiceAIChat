export type IntegrationTokenScope = 'tasks:external'

export interface IntegrationPrincipal {
  kind: 'integration'
  projectId: string
  projectIds: string[]
  scopes: IntegrationTokenScope[]
}

export interface IntegrationTokenView {
  id: string
  /** Primary project retained for compatibility and token management. */
  projectId: string
  /** All projects that the integration may access; projectId is always first. */
  projectIds: string[]
  name: string
  scopes: IntegrationTokenScope[]
  createdAt: number
  lastUsedAt: number | null
}
