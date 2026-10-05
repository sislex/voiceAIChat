import type { DevComponentId, DevStandErrorCode } from './devStand'

export interface DevProcessTarget { standId: string; component: DevComponentId }
export interface DevProcessStartRequest extends DevProcessTarget {
  repository: string
  /** Full lowercase 40-character SHA, resolved before sending to the agent. */
  sha: string
  /** Executable followed by arguments; default: ['npm', 'run', 'dev:component']. */
  command: [string, ...string[]]
  env: Record<string, string>
  /** Allocated port, not necessarily the registry default. */
  port: number
}
export type DevProcessStopRequest = DevProcessTarget
export type DevProcessStatusRequest = DevProcessTarget
export interface DevProcessLogsRequest extends DevProcessTarget {
  /** Maximum number of trailing lines; omitted means 200, valid range 1..1000. */
  limit?: number
}
export interface DevProcessStatus extends DevProcessTarget {
  state: 'stopped' | 'starting' | 'ready' | 'stopping' | 'failed'
  repository?: string
  sha?: string
  url?: string
  /** Unix milliseconds. */
  startedAt?: number
  exitCode?: number | null
}
/** Start succeeds only after readiness; stop succeeds after process-tree cleanup. */
export interface DevProcessStartResult extends DevProcessStatus {
  state: 'ready'
  repository: string
  sha: string
  url: string
  startedAt: number
}
export interface DevProcessStopResult extends DevProcessTarget { state: 'stopped' }
export interface DevProcessLogsResult extends DevProcessTarget {
  /** Secrets must be redacted by the agent before transmission. */
  lines: Array<{ stream: 'stdout' | 'stderr'; text: string; at: number }>
  truncated: boolean
}

/** One source for operation names, typed envelopes, and dispatch registries. */
export interface DevProcessRpc {
  'devProcess.start': { request: DevProcessStartRequest; result: DevProcessStartResult }
  'devProcess.stop': { request: DevProcessStopRequest; result: DevProcessStopResult }
  'devProcess.status': { request: DevProcessStatusRequest; result: DevProcessStatus }
  'devProcess.logs': { request: DevProcessLogsRequest; result: DevProcessLogsResult }
}
export type DevProcessMethod = keyof DevProcessRpc
const methods = {
  'devProcess.start': true, 'devProcess.stop': true, 'devProcess.status': true, 'devProcess.logs': true
} as const satisfies Record<DevProcessMethod, true>
export const DEV_PROCESS_REQUEST_TYPES = Object.keys(methods) as DevProcessMethod[]
export type DevProcessRequestMessage = {
  [M in DevProcessMethod]: { t: M; requestId: string } & DevProcessRpc[M]['request']
}[DevProcessMethod]
export type DevProcessResultMessage = {
  [M in DevProcessMethod]: { t: `${M}.result`; requestId: string; result: DevProcessRpc[M]['result'] }
}[DevProcessMethod]
export interface DevProcessErrorMessage {
  t: 'devProcess.error'
  requestId: string
  method: DevProcessMethod
  code: DevStandErrorCode
  message: string
}
export type DevProcessResponseMessage = DevProcessResultMessage | DevProcessErrorMessage
export const DEV_PROCESS_RESPONSE_TYPES: DevProcessResponseMessage['t'][] = [
  ...DEV_PROCESS_REQUEST_TYPES.map(method => `${method}.result` as const), 'devProcess.error'
]
