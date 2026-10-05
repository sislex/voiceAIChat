import { isKbScope } from './kb'
import type {
  KbContextBundle, KbContextRequest, KbDocument, KbDocumentDraft,
  KbDocumentSummary, KbModule, KbProjectUsageReport, KbRunUsageReport,
  KbSearchRequest, KbSearchResult, KbStatus, KbTaskUsageReport,
  KbTopicsRequest, KbUsageReport
} from './kb'

export function isKbModuleId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

export interface KbFileDocumentId { module: string; path: string }

/** File topic IDs only; database document IDs remain opaque and unchanged. */
export function parseKbFileDocumentId(id: string): KbFileDocumentId | null {
  const separator = id.indexOf(':')
  const module = separator < 0 ? 'core' : id.slice(0, separator)
  const path = separator < 0 ? id : id.slice(separator + 1)
  if (!isKbModuleId(module) || !path || /[:\\\u0000-\u001f]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..')) return null
  return { module, path }
}

/** Preserve the topic path verbatim, including legacy extensionless IDs. */
export function formatKbFileDocumentId(module: string, path: string): string {
  const id = `${module}:${path}`
  if (!parseKbFileDocumentId(id)) throw new TypeError('Invalid KB file document ID')
  return id
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
function optionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}
const kinds = ['feature', 'subsystem', 'protocol', 'decision', 'convention', 'runbook', 'package']

/** Validate decoded transport values without imposing new limits on legacy requests. */
export function isKbTopicsRequest(value: unknown): value is KbTopicsRequest | void {
  return value === undefined || (record(value)
    && (value.module === undefined || isKbModuleId(value.module))
    && (value.scope === undefined || isKbScope(value.scope))
    && (value.projectId === undefined || value.projectId === null || typeof value.projectId === 'string'))
}
export function isKbSearchRequest(value: unknown): value is KbSearchRequest {
  return record(value) && isKbTopicsRequest(value) && typeof value.query === 'string'
    && optionalNumber(value.limit)
    && (value.tags === undefined || strings(value.tags))
    && (value.kinds === undefined || (strings(value.kinds) && value.kinds.every(kind => kinds.includes(kind))))
}
export function isKbContextRequest(value: unknown): value is KbContextRequest {
  return record(value) && isKbTopicsRequest(value) && typeof value.query === 'string'
    && optionalNumber(value.budget)
}

export type KbUsageRequest =
  | { target: 'conversation'; conversationId: string }
  | { target: 'project'; projectId: string }
  | { target: 'run'; runId: string }
  | { target: 'task'; projectId: string; taskId: string }
export type KbUsageResult =
  | { target: 'conversation'; report: KbUsageReport }
  | { target: 'project'; report: KbProjectUsageReport }
  | { target: 'run'; report: KbRunUsageReport }
  | { target: 'task'; report: KbTaskUsageReport }

/** Stable method names for both local and remote knowledge service transports.
 * Authentication and viewer authorization are supplied by the host, never by arg.
 * JSON transports omit arg for void requests and encode the void delete result as null.
 */
export interface KbServiceRpcMap {
  status: { arg: void; result: KbStatus }
  modules: { arg: void; result: KbModule[] }
  topics: { arg: KbTopicsRequest | void; result: KbDocumentSummary[] }
  document: { arg: { id: string }; result: KbDocument | null }
  search: { arg: KbSearchRequest; result: KbSearchResult[] }
  context: { arg: KbContextRequest; result: KbContextBundle }
  write: { arg: KbDocumentDraft; result: KbDocument }
  delete: { arg: { id: string }; result: void }
  usage: { arg: KbUsageRequest; result: KbUsageResult }
}
export type KbServiceRpcMethod = keyof KbServiceRpcMap
export type KbServiceRpcArg<M extends KbServiceRpcMethod> = KbServiceRpcMap[M]['arg']
export type KbServiceRpcResult<M extends KbServiceRpcMethod> = KbServiceRpcMap[M]['result']

const documentRequest = (value: unknown): value is { id: string } =>
  record(value) && typeof value.id === 'string' && value.id.length > 0

/** Runtime registry also makes missing methods a compile-time error. */
export const KB_SERVICE_RPC = {
  status: (value: unknown): value is void => value === undefined,
  modules: (value: unknown): value is void => value === undefined,
  topics: isKbTopicsRequest,
  document: documentRequest,
  search: isKbSearchRequest,
  context: isKbContextRequest,
  write: (value: unknown): value is KbDocumentDraft => record(value)
    && isKbScope(value.scope) && typeof value.title === 'string' && typeof value.body === 'string'
    && (value.id === undefined || typeof value.id === 'string')
    && (value.projectId === undefined || value.projectId === null || typeof value.projectId === 'string')
    && (value.kind === undefined || (typeof value.kind === 'string' && kinds.includes(value.kind)))
    && (value.tags === undefined || strings(value.tags))
    && (value.areas === undefined || strings(value.areas)),
  delete: documentRequest,
  usage: (value: unknown): value is KbUsageRequest => {
    if (!record(value)) return false
    switch (value.target) {
      case 'conversation': return typeof value.conversationId === 'string'
      case 'project': return typeof value.projectId === 'string'
      case 'run': return typeof value.runId === 'string'
      case 'task': return typeof value.projectId === 'string' && typeof value.taskId === 'string'
      default: return false
    }
  }
} satisfies { [M in KbServiceRpcMethod]: (value: unknown) => value is KbServiceRpcArg<M> }

export type KbServiceRpcHandlers<Viewer> = {
  [M in KbServiceRpcMethod]: (arg: KbServiceRpcArg<M>, viewer: Viewer) => Promise<KbServiceRpcResult<M>>
}

/** Boundary adapter: validates decoded input before calling a viewer-scoped handler. */
export function createKbServiceRpcDispatcher<Viewer>(handlers: KbServiceRpcHandlers<Viewer>) {
  return async <M extends KbServiceRpcMethod>(method: M, arg: unknown, viewer: Viewer): Promise<KbServiceRpcResult<M>> => {
    if (!Object.prototype.hasOwnProperty.call(KB_SERVICE_RPC, method) || !KB_SERVICE_RPC[method](arg)) {
      throw new TypeError('Invalid KB RPC request')
    }
    return handlers[method](arg as KbServiceRpcArg<M>, viewer)
  }
}
