import { CORE_ID_HEADER, CORE_MCP_TOKEN_TTL_MS, DELEGATION_HEADER_NAME, type ApplicationId } from '@voicechat/shared'
import { signCoreMcpToken } from '@sislexa/component-runtime'
import type { TicketDelegations } from '../auth/ticketDelegation.js'

/** Lifetime of a delegation minted for one Core→service call; it is never handed to a browser. */
export const EXTERNAL_CALL_DELEGATION_TTL_MS = 5 * 60_000

export interface ExternalServiceFetchOptions {
  application: ApplicationId
  coreId: string
  /** `VC_APPLICATION_<ID>_SERVICE_TOKEN`: the credential the service registry stores for this core. */
  serviceToken: string
  delegations: TicketDelegations
  /** User of a user-scoped RPC method, or undefined for build-level methods. */
  userOf?: (method: string, args: unknown[]) => Promise<{ userId: string; tenantId: string | null } | undefined>
  fetchImpl?: typeof fetch
  now?: () => number
}

/**
 * Fetch for Core→service RPC to an external application: the bearer is this core's service credential, the core
 * names itself in `x-sislexa-core-id`, and user-scoped methods carry a short server-side delegation of that user.
 */
export function externalServiceFetch(options: ExternalServiceFetchOptions): typeof fetch {
  const now = options.now ?? Date.now
  return async (input, init = {}) => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${options.serviceToken}`)
    headers.set(CORE_ID_HEADER, options.coreId)
    headers.delete(DELEGATION_HEADER_NAME)
    if (options.userOf && typeof init.body === 'string') {
      let rpc: { method?: unknown; args?: unknown } | undefined
      try { rpc = JSON.parse(init.body) as typeof rpc } catch { rpc = undefined }
      const user = rpc && typeof rpc.method === 'string' && Array.isArray(rpc.args) ? await options.userOf(rpc.method, rpc.args) : undefined
      if (user) headers.set(DELEGATION_HEADER_NAME, options.delegations.issue({ userId: user.userId, tenantId: user.tenantId,
        applicationId: options.application, coreId: options.coreId, sid: null, expiresAt: now() + EXTERNAL_CALL_DELEGATION_TTL_MS }).token)
    }
    return (options.fetchImpl ?? fetch)(input, { ...init, headers })
  }
}

export interface ExternalMcpOptions {
  coreId: string
  /** Enabled external applications and their public URLs. */
  url: (application: ApplicationId) => string | undefined
  secrets: Partial<Record<ApplicationId, string>>
  now?: () => number
}
const MCP_PATHS: Partial<Record<ApplicationId, string>> = { make: '/mcp/make', 'image-studio': '/mcp/image-studio' }
/** Per-turn MCP URL of an external application, signed for this core, user and conversation. */
export function externalMcpUrls(options: ExternalMcpOptions) {
  const now = options.now ?? Date.now
  return (application: ApplicationId, context: { userId: string; conversationId: string; turnId?: string }): string | undefined => {
    const url = options.url(application)
    const secret = options.secrets[application]
    const path = MCP_PATHS[application]
    if (!url || !secret || !path) return undefined
    const token = signCoreMcpToken(secret, { v: 1, coreId: options.coreId, application, userId: context.userId,
      conversationId: context.conversationId, ...(context.turnId ? { turnId: context.turnId } : {}), expiresAt: now() + CORE_MCP_TOKEN_TTL_MS })
    return `${url}${path}?k=${encodeURIComponent(token)}`
  }
}
