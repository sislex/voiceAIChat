import type { SessionUser } from './types.js'

export const APPLICATION_IDS = ['chat', 'make', 'projects', 'web-reader', 'playwright-reader', 'image-studio', 'identity', 'storage'] as const
export type ApplicationId = typeof APPLICATION_IDS[number]
export interface DeploymentApplication { id: ApplicationId; enabled: boolean; location: 'local' | 'external'; url?: string; openUrl?: string }
export interface DeploymentManifest { coreId: string; applications: DeploymentApplication[] }
export function isApplicationId(value: unknown): value is ApplicationId { return APPLICATION_IDS.includes(value as ApplicationId) }
export function validateCoreId(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(value)) throw new Error('invalid_core_id')
  return value
}
export function applicationUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('invalid_application_url')
  return url.href.replace(/\/$/, '')
}
export function parseApplications(value?: string): DeploymentApplication[] {
  const selected = new Map<ApplicationId, string | undefined>()
  for (const item of value === undefined ? APPLICATION_IDS : value === '' ? [] : value.split(',')) {
    const separator = item.indexOf('=')
    const id = (separator < 0 ? item : item.slice(0, separator)).trim()
    if (!isApplicationId(id) || selected.has(id)) throw new Error('invalid_applications')
    selected.set(id, separator < 0 ? undefined : applicationUrl(item.slice(separator + 1).trim()))
  }
  return APPLICATION_IDS.map(id => ({
    id,
    enabled: selected.has(id),
    location: selected.get(id) ? 'external' : 'local',
    ...(selected.get(id) ? { url: selected.get(id), openUrl: `/applications/${id}/open` } : {})
  }))
}
export function serializeApplications(applications: DeploymentApplication[]): string {
  const value = applications.filter(a => a.enabled).map(a => a.location === 'external' ? `${a.id}=${applicationUrl(a.url ?? '')}` : a.id).join(',')
  parseApplications(value)
  return value
}
export interface EnterTicketRedeemRequest { ticket: string; application: ApplicationId }
/**
 * Core-issued delegation returned with a redeemed ticket. The service sends it as `x-sislexa-delegation`
 * together with its own service credential (`authorization: Bearer …`) to act for the user in that core.
 */
export interface EnterTicketDelegation { token: string; expiresAt: number }
export interface EnterTicketRedeemResponse { user: SessionUser; tenantId: string | null; capabilities: string[]; expiresAt: number; delegation: EnterTicketDelegation }
export const TICKET_DELEGATION_PREFIX = 'sxd_'
export function isTicketDelegationToken(value: unknown): value is string {
  return typeof value === 'string' && /^sxd_[A-Za-z0-9_-]{43}$/.test(value)
}
/** Shape check for a redeem response; the delegation must not outlive the session it belongs to. */
export function isEnterTicketRedeemResponse(value: unknown, now = Date.now()): value is EnterTicketRedeemResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<EnterTicketRedeemResponse>
  return typeof v.user?.name === 'string' && !!v.user.name && Array.isArray(v.capabilities) && v.capabilities.every(c => typeof c === 'string')
    && (v.tenantId === null || typeof v.tenantId === 'string') && Number.isSafeInteger(v.expiresAt) && v.expiresAt! > now
    && !!v.delegation && isTicketDelegationToken(v.delegation.token) && Number.isSafeInteger(v.delegation.expiresAt)
    && v.delegation.expiresAt > now && v.delegation.expiresAt <= v.expiresAt!
}
export interface CoreLimits { diskBytes?: number; workshops?: number; machines?: number }
/**
 * A core trusted by a shared service. `credentialRef` is the service's own credential for calls into the core
 * (`VC_APPLICATION_<ID>_TOKEN` there); `serviceCredentialRef` verifies the core's calls into the service
 * (`VC_APPLICATION_<ID>_SERVICE_TOKEN` there); `mcpSecretRef` verifies MCP tokens the core issues for turns
 * (`VC_APPLICATION_<ID>_MCP_SECRET` there). Refs are resolved server side and never returned.
 */
export interface TrustedCoreEntry { coreId: string; url: string; credentialRef: string; serviceCredentialRef?: string; mcpSecretRef?: string; limits?: CoreLimits }
export interface CoreUsage { coreId: string; diskBytes: number; workshops: number; machines: number }
export type DeploymentErrorCode = 'application_disabled' | 'ticket_invalid' | 'ticket_used' | 'core_unknown' | 'core_limit_exceeded'
export interface SharedServiceSession extends EnterTicketRedeemResponse { coreId: string }

/** Core→service calls name the calling core; the bearer is that core's service credential. */
export const CORE_ID_HEADER = 'x-sislexa-core-id'
export const DELEGATION_HEADER_NAME = 'x-sislexa-delegation'
/**
 * How a shared service's call into a core internal RPC path is authorised when it presents its application token:
 * - `{ user: n }`: user-scoped; requires a live ticket delegation of the same application and `args[n]` must be the
 *   delegated user (an empty value is filled with it);
 * - `{ userField: f }`: the same for a JSON body field (non-RPC endpoints);
 * - `{ userArg: n, field: f }`: the same for the field `f` of the object argument `args[n]`;
 * - `'delegated'`: requires a live delegation of the application, no user argument;
 * - `'service'`: build-level authority of the application, the application token alone is enough.
 * Methods missing from the table are refused to application callers; the build-wide internal token path is unchanged.
 * A caller acting through a task-scoped MCP token is read-only: only the route's `readMethods` are allowed.
 */
export type SharedRpcAuthority = { user: number } | { userField: string } | { userArg: number; field: string } | 'delegated' | 'service'
export interface SharedServiceRpcRoute {
  application: ApplicationId
  methods?: Readonly<Record<string, SharedRpcAuthority>>
  body?: SharedRpcAuthority
  /** Methods a read-only (task-scoped MCP) caller may use. */
  readMethods?: readonly string[]
}
const u0 = { user: 0 } as const
const entryUser = { userArg: 0, field: 'userId' } as const
export const SHARED_SERVICE_RPC_ROUTES: Readonly<Record<string, SharedServiceRpcRoute>> = {
  '/internal/make/core': { application: 'make', methods: {
    conversation: u0, isProjectViewer: u0, makeConversationIdsOf: u0, linkableTasks: u0, linkTaskDesign: u0, unlinkTaskDesign: u0,
    taskDesigns: u0, project: u0, listProjects: u0, projectStructure: u0, projectDesign: u0, projectNotesRead: u0,
    projectNotesUpdate: u0, projectGit: u0, standPreview: u0, makeStand: u0, createTransferTask: u0,
    conversationOwner: 'service', conversationProject: 'service', taskLinks: 'service', userExists: 'service', boardChanged: 'service'
  }, readMethods: ['conversation', 'isProjectViewer', 'makeConversationIdsOf', 'taskDesigns', 'project', 'listProjects', 'projectStructure',
    'projectDesign', 'projectNotesRead', 'conversationOwner', 'conversationProject', 'taskLinks', 'userExists'] },
  '/internal/make/events': { application: 'make', body: 'delegated' },
  '/internal/image-studio/core': { application: 'image-studio', methods: { conversation: u0, renameConversation: u0, readGenerated: u0 } },
  '/internal/image-studio/generate': { application: 'image-studio', body: { userField: 'userId' } },
  '/internal/reader/core': { application: 'web-reader', methods: {
    canUseMachine: u0, machineHttp: u0, previewAction: u0, issuePreviewRunKey: u0, logBrowserShot: u0, machineOnline: 'service',
    context: entryUser, logBrowserEvidence: entryUser, projectResource: 'delegated'
  } },
  // Web Reader drives the core's Playwright Reader browser for its user when Playwright Reader runs inside the core.
  '/internal/playwright-reader/service': { application: 'web-reader', methods: { execute: u0, screenshot: u0, control: u0 } },
  '/internal/playwright-reader/core': { application: 'playwright-reader', methods: { conversation: u0, modelTarget: u0, issuePreviewRunKey: u0, logBrowserShot: u0 } },
  '/internal/kanban/core': { application: 'projects', body: 'service' },
  '/internal/kanban/events': { application: 'projects', body: 'service' },
  '/internal/kanban/exec-stream': { application: 'projects', body: 'service' }
}
/** Conversation kind a delegated `POST /api/conversations` of an application may create. */
export const APPLICATION_ASSISTANT_KIND: Readonly<Partial<Record<ApplicationId, 'make' | 'images' | 'web-recorder' | 'playwright-reader'>>> = {
  make: 'make', 'image-studio': 'images', 'web-reader': 'web-recorder', 'playwright-reader': 'playwright-reader'
}
export interface SharedServiceCaller { application: ApplicationId; userId?: string; tenantId?: string | null; readOnly?: boolean }
export type SharedRpcVerdict = { ok: true; body: unknown } | { ok: false; status: 401 | 403; error: 'delegation_required' | 'delegation_denied' | 'method_denied' }
/** Apply the authority table to an application caller's request body; returns the body to dispatch. */
export function authorizeSharedServiceRpc(path: string, body: unknown, caller: SharedServiceCaller): SharedRpcVerdict {
  const route = SHARED_SERVICE_RPC_ROUTES[path]
  if (!route || route.application !== caller.application) return { ok: false, status: 403, error: 'method_denied' }
  let authority = route.body
  let args: unknown[] | undefined
  let method: string | undefined
  if (route.methods) {
    const rpc = body as { method?: unknown; args?: unknown } | null
    if (!rpc || typeof rpc.method !== 'string' || !Array.isArray(rpc.args) || !Object.hasOwn(route.methods, rpc.method)) return { ok: false, status: 403, error: 'method_denied' }
    method = rpc.method
    args = [...rpc.args]
    authority = route.methods[method]
  }
  if (!authority) return { ok: false, status: 403, error: 'method_denied' }
  if (caller.readOnly && (!method || !route.readMethods?.includes(method))) return { ok: false, status: 403, error: 'method_denied' }
  if (authority === 'service') return { ok: true, body }
  if (!caller.userId) return { ok: false, status: 401, error: 'delegation_required' }
  if (authority === 'delegated') return { ok: true, body }
  if ('user' in authority) {
    const value = args![authority.user]
    if (value !== undefined && value !== null && value !== '' && value !== caller.userId) return { ok: false, status: 403, error: 'delegation_denied' }
    args![authority.user] = caller.userId
    return { ok: true, body: { ...(body as object), method, args } }
  }
  if ('userArg' in authority) {
    const entry = args![authority.userArg]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, status: 403, error: 'delegation_denied' }
    const value = (entry as Record<string, unknown>)[authority.field]
    if (value !== undefined && value !== null && value !== '' && value !== caller.userId) return { ok: false, status: 403, error: 'delegation_denied' }
    args![authority.userArg] = { ...entry, [authority.field]: caller.userId }
    return { ok: true, body: { ...(body as object), method, args } }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 403, error: 'delegation_denied' }
  const value = (body as Record<string, unknown>)[authority.userField]
  if (value !== undefined && value !== null && value !== '' && value !== caller.userId) return { ok: false, status: 403, error: 'delegation_denied' }
  return { ok: true, body: { ...(body as object), [authority.userField]: caller.userId } }
}
/**
 * MCP credential a core issues per turn for an external application: `sxm1.<payload>.<mac>`, where payload is the
 * base64url JSON of these claims and mac is base64url HMAC-SHA256 over `sxm1.<payload>` keyed by the application's
 * MCP secret. Signing and verification live in `@sislexa/component-runtime` (Node only).
 */
export interface CoreMcpTokenClaims { v: 1; coreId: string; application: ApplicationId; userId: string; conversationId: string; turnId?: string; scope?: CoreMcpTaskScope; expiresAt: number }
/**
 * Read-only task scope of an MCP token issued for one task source conversation (`conversationId`): the service lets
 * the task run list and read only these files, and Core accepts the token only for the route's `readMethods`.
 */
export interface CoreMcpTaskScope { taskId: string; projectId: string; mode: 'whole_project' | 'files'; paths: string[] }
export function isCoreMcpTaskScope(value: unknown): value is CoreMcpTaskScope {
  const s = value as Partial<CoreMcpTaskScope> | null
  return !!s && typeof s === 'object' && typeof s.taskId === 'string' && !!s.taskId && typeof s.projectId === 'string' && !!s.projectId
    && (s.mode === 'whole_project' || s.mode === 'files') && Array.isArray(s.paths) && s.paths.every(p => typeof p === 'string')
}
/** A shared service presents the core-issued MCP token of the current turn to act for its user (instead of a delegation). */
export const MCP_TOKEN_HEADER_NAME = 'x-sislexa-mcp-token'
export const CORE_MCP_TOKEN_PREFIX = 'sxm1.'
export const CORE_MCP_TOKEN_TTL_MS = 6 * 60 * 60_000
