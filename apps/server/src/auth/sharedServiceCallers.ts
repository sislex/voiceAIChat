import { createHash, timingSafeEqual } from 'node:crypto'
import { SHARED_SERVICE_RPC_ROUTES, type ApplicationId, type SharedServiceCaller } from '@voicechat/shared'
import type { TicketDelegations } from './ticketDelegation.js'

export interface SharedServiceAuthorityOptions {
  /** Per-application service→core credentials (`VC_APPLICATION_<ID>_TOKEN`); never the build-wide internal token. */
  credentials: Partial<Record<ApplicationId, string>>
  /** The application is enabled, external and has a credential. */
  enabled: (application: ApplicationId) => boolean
  delegations: TicketDelegations
}
export type SharedServiceAuthentication = { caller: SharedServiceCaller } | { status: 401; error: 'delegation_denied' }
const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * Recognises an external application calling one of its own internal RPC paths with its application token.
 * Returns undefined for any other caller so the existing internal-token/component-grant checks apply unchanged.
 */
export function createSharedServiceAuthority(options: SharedServiceAuthorityOptions) {
  return {
    authenticate(path: string, headers: Record<string, string | string[] | undefined>): SharedServiceAuthentication | undefined {
      const route = Object.hasOwn(SHARED_SERVICE_RPC_ROUTES, path) ? SHARED_SERVICE_RPC_ROUTES[path] : undefined
      const credential = route && options.credentials[route.application]
      const authorization = headers.authorization
      if (!route || !credential || !options.enabled(route.application) || typeof authorization !== 'string'
        || !timingSafeEqual(digest(authorization), digest(`Bearer ${credential}`))) return undefined
      const header = headers['x-sislexa-delegation']
      if (header === undefined) return { caller: { application: route.application } }
      const grant = typeof header === 'string' ? options.delegations.lookup(header) : undefined
      if (!grant || grant.applicationId !== route.application) return { status: 401, error: 'delegation_denied' }
      return { caller: { application: route.application, userId: grant.userId, tenantId: grant.tenantId } }
    }
  }
}
export type SharedServiceAuthority = ReturnType<typeof createSharedServiceAuthority>
