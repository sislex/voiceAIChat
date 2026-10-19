import { createHash, timingSafeEqual } from 'node:crypto'
import { DELEGATION_HEADER_NAME, MCP_TOKEN_HEADER_NAME, SHARED_SERVICE_RPC_ROUTES, type ApplicationId, type SharedServiceCaller } from '@voicechat/shared'
import { verifyCoreMcpTokenWithSecret } from '@sislexa/component-runtime'
import type { TicketDelegations } from './ticketDelegation.js'

export interface SharedServiceAuthorityOptions {
  /** Per-application service→core credentials (`VC_APPLICATION_<ID>_TOKEN`); never the build-wide internal token. */
  credentials: Partial<Record<ApplicationId, string>>
  /** The application is enabled, external and has a credential. */
  enabled: (application: ApplicationId) => boolean
  delegations: TicketDelegations
  /** This core and the per-application MCP secrets (`VC_APPLICATION_<ID>_MCP_SECRET`) of the tokens it issues. */
  coreId?: string
  mcpSecrets?: Partial<Record<ApplicationId, string>>
  now?: () => number
}
export type SharedServiceAuthentication = { caller: SharedServiceCaller } | { status: 401; error: 'delegation_denied' }
const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * Recognises an external application calling one of its own internal RPC paths with its application token.
 * The user comes from a ticket delegation (`x-sislexa-delegation`) or from the core-issued MCP token of the turn
 * the service is serving (`x-sislexa-mcp-token`); presenting both is refused.
 * Returns undefined for any other caller so the existing internal-token/component-grant checks apply unchanged.
 */
export function createSharedServiceAuthority(options: SharedServiceAuthorityOptions) {
  const now = options.now ?? Date.now
  const denied = { status: 401, error: 'delegation_denied' } as const
  return {
    authenticate(path: string, headers: Record<string, string | string[] | undefined>): SharedServiceAuthentication | undefined {
      const route = Object.hasOwn(SHARED_SERVICE_RPC_ROUTES, path) ? SHARED_SERVICE_RPC_ROUTES[path] : undefined
      const credential = route && options.credentials[route.application]
      const authorization = headers.authorization
      if (!route || !credential || !options.enabled(route.application) || typeof authorization !== 'string'
        || !timingSafeEqual(digest(authorization), digest(`Bearer ${credential}`))) return undefined
      const header = headers[DELEGATION_HEADER_NAME]
      const mcpToken = headers[MCP_TOKEN_HEADER_NAME]
      if (header !== undefined && mcpToken !== undefined) return denied
      if (mcpToken !== undefined) {
        const secret = options.mcpSecrets?.[route.application]
        if (typeof mcpToken !== 'string' || !secret || !options.coreId) return denied
        try {
          const claims = verifyCoreMcpTokenWithSecret(secret, mcpToken, now())
          if (claims.application !== route.application || claims.coreId !== options.coreId) return denied
          return { caller: { application: route.application, userId: claims.userId, ...(claims.scope ? { readOnly: true } : {}) } }
        } catch { return denied }
      }
      if (header === undefined) return { caller: { application: route.application } }
      const grant = typeof header === 'string' ? options.delegations.lookup(header) : undefined
      if (!grant || grant.applicationId !== route.application) return denied
      return { caller: { application: route.application, userId: grant.userId, tenantId: grant.tenantId } }
    }
  }
}
export type SharedServiceAuthority = ReturnType<typeof createSharedServiceAuthority>
