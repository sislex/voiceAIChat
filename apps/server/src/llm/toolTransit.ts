// Provider side of the model API tool transit (contract: packages/shared/src/modelToolTransit.ts).
//
// The provider owns no tool of the application and never looks inside a call: it only gives the
// runner an address of its own for every endpoint the application declared for a run and relays the
// HTTP exchange over the application's outgoing WebSocket — the same shape as a machine agent that
// sits behind NAT and receives commands over the socket it opened itself.

import { randomBytes, randomUUID } from 'node:crypto'
import {
  MODEL_TOOL_TRANSIT, MODEL_TOOL_TRANSIT_LIMITS, MODEL_TOOL_TRANSIT_REQUEST_HEADERS, MODEL_TOOL_TRANSIT_RESPONSE_HEADERS,
  parseModelToolTransitApplicationFrame, parseModelToolTransitPlaceholder,
  type LlmRequest, type ModelToolTransitProviderFrame
} from '@voicechat/shared'

/** The part of a WebSocket the hub needs; `ws` and test doubles both fit. */
export interface TransitSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: 'message', listener: (data: unknown) => void): unknown
  on(event: 'close' | 'error', listener: () => void): unknown
}

export interface TransitSink {
  head(status: number, headers: Record<string, string>): void
  chunk(data: Buffer): void
  end(): void
  /** The call produced no (complete) response; `status` is what the runner should see. */
  fail(status: number, message: string): void
}

export interface TransitLimits {
  slots: number
  requestBytes: number
  responseBytes: number
  callTimeoutMs: number
  callsPerRun: number
  concurrentCallsPerRun: number
}

interface Connection { id: string; sid: string; socket: TransitSocket; calls: Map<string, Call>; open: boolean }
interface Run { token: string; sid: string; connection: Connection; slots: Set<string>; calls: number; failed: number; active: number }
interface Call { run: Run; sink: TransitSink; timer: ReturnType<typeof setTimeout>; bytes: number; head: boolean; done: boolean }

export interface TransitRun {
  token: string
  /** Runner-facing address of a declared placeholder. */
  url(placeholder: { slot: string; query: string }): string
  /** Ends the run: its addresses stop resolving. Returns the audit counters. */
  close(): { calls: number; failed: number }
}

export class ToolTransitHub {
  private readonly connections = new Map<string, Connection>()
  private readonly runs = new Map<string, Run>()
  private readonly limits: TransitLimits

  constructor(private readonly publicBase: string, limits: Partial<TransitLimits> = {}) {
    this.limits = { ...MODEL_TOOL_TRANSIT_LIMITS, ...limits }
  }

  /** Registers the application's socket; `sid` is the model token session it authenticated with. */
  attach(socket: TransitSocket, sid: string): string {
    const connection: Connection = { id: randomUUID(), sid, socket, calls: new Map(), open: true }
    this.connections.set(connection.id, connection)
    socket.on('message', (data) => this.receive(connection, String(data)))
    const drop = () => this.drop(connection)
    socket.on('close', drop)
    socket.on('error', drop)
    this.push(connection, { t: 'ready', id: connection.id })
    return connection.id
  }

  /** Opens the addresses of one run. Null: the transit is not this token's live connection. */
  open(sid: string, transitId: string, slots: readonly string[]): TransitRun | null {
    const connection = this.connections.get(transitId)
    if (!connection || !connection.open || connection.sid !== sid) return null
    if (slots.length > this.limits.slots || new Set(slots).size !== slots.length) return null
    const run: Run = { token: randomBytes(24).toString('base64url'), sid, connection, slots: new Set(slots), calls: 0, failed: 0, active: 0 }
    this.runs.set(run.token, run)
    const base = this.publicBase.replace(/\/+$/, '')
    return {
      token: run.token,
      url: ({ slot, query }) => `${base}${MODEL_TOOL_TRANSIT.http}/${run.token}/${slot}${query ? '?' + query : ''}`,
      close: () => {
        this.runs.delete(run.token)
        for (const [id, call] of connection.calls) if (call.run === run) this.finish(connection, id, call, () => call.sink.fail(410, 'run_finished'), true)
        return { calls: run.calls, failed: run.failed }
      }
    }
  }

  /** Relays one runner request. The sink always receives exactly one of `end` or `fail`. */
  relay(token: string, slot: string, request: { method: string; headers: Record<string, string | string[] | undefined>; body?: Buffer }, sink: TransitSink): { abort(): void } {
    const run = this.runs.get(token)
    if (!run || !run.slots.has(slot)) { sink.fail(404, 'unknown_endpoint'); return { abort() {} } }
    if (!run.connection.open) { run.failed++; sink.fail(502, 'application_disconnected'); return { abort() {} } }
    if (run.calls >= this.limits.callsPerRun || run.active >= this.limits.concurrentCallsPerRun) { run.failed++; sink.fail(429, 'call_limit_exceeded'); return { abort() {} } }
    if ((request.body?.length ?? 0) > this.limits.requestBytes) { run.failed++; sink.fail(413, 'request_too_large'); return { abort() {} } }
    const id = randomUUID(), connection = run.connection
    const call: Call = { run, sink, bytes: 0, head: false, done: false,
      timer: setTimeout(() => { run.failed++; this.finish(connection, id, call, () => sink.fail(504, 'call_timeout'), true) }, this.limits.callTimeoutMs) }
    call.timer.unref?.()
    run.calls++; run.active++
    connection.calls.set(id, call)
    const headers: Record<string, string> = {}
    for (const name of MODEL_TOOL_TRANSIT_REQUEST_HEADERS) {
      const value = request.headers[name]
      if (typeof value === 'string') headers[name] = value
    }
    this.push(connection, { t: 'req', call: id, slot, method: request.method, headers,
      ...(request.body?.length ? { body: request.body.toString('base64') } : {}) })
    return { abort: () => this.finish(connection, id, call, () => {}, true) }
  }

  get stats(): { connections: number; runs: number } {
    return { connections: this.connections.size, runs: this.runs.size }
  }

  private push(connection: Connection, frame: ModelToolTransitProviderFrame): void {
    try { connection.socket.send(JSON.stringify(frame)) } catch { this.drop(connection) }
  }

  private finish(connection: Connection, id: string, call: Call, settle: () => void, abort: boolean): void {
    if (call.done) return
    call.done = true
    clearTimeout(call.timer)
    connection.calls.delete(id)
    call.run.active--
    if (abort && connection.open) this.push(connection, { t: 'abort', call: id })
    settle()
  }

  private receive(connection: Connection, raw: string): void {
    const frame = parseModelToolTransitApplicationFrame(raw)
    const call = frame ? connection.calls.get(frame.call) : undefined
    if (!frame || !call) return
    const id = frame.call
    if (frame.t === 'head') {
      if (call.head) return
      call.head = true
      const headers: Record<string, string> = {}
      for (const name of MODEL_TOOL_TRANSIT_RESPONSE_HEADERS) if (frame.headers[name]) headers[name] = frame.headers[name]!
      call.sink.head(frame.status, headers)
    } else if (frame.t === 'chunk') {
      const data = Buffer.from(frame.data, 'base64')
      call.bytes += data.length
      if (!call.head || call.bytes > this.limits.responseBytes) {
        call.run.failed++
        this.finish(connection, id, call, () => call.sink.fail(502, call.head ? 'response_too_large' : 'invalid_response'), true)
      } else call.sink.chunk(data)
    } else if (frame.t === 'end') {
      this.finish(connection, id, call, () => call.head ? call.sink.end() : call.sink.fail(502, 'invalid_response'), false)
    } else {
      call.run.failed++
      this.finish(connection, id, call, () => call.sink.fail(502, 'application_error'), false)
    }
  }

  private drop(connection: Connection): void {
    if (!connection.open) return
    connection.open = false
    this.connections.delete(connection.id)
    for (const [id, call] of connection.calls) {
      call.run.failed++
      this.finish(connection, id, call, () => call.sink.fail(502, 'application_disconnected'), false)
    }
    try { connection.socket.close(1001, 'closed') } catch { /* already gone */ }
  }
}

const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions']
const URL_FIELDS = ['kbMcpUrl', 'historyMcpUrl', 'previewMcpUrl', 'consoleMcpUrl', 'makeMcpUrl', 'imageStudioMcpUrl', 'kanbanMcpUrl'] as const
const short = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

/**
 * Reads the tool surface an application declared for a run. Every address must be a `transit:`
 * placeholder: the provider never calls an address named by a caller. Null — the request is invalid.
 */
export function transitRequest(body: Record<string, unknown>): { slots: string[]; build(url: (p: { slot: string; query: string }) => string): Partial<LlmRequest> } | null {
  const slots: string[] = []
  const placeholder = (value: unknown) => {
    const parsed = parseModelToolTransitPlaceholder(value)
    if (parsed) slots.push(parsed.slot)
    return parsed
  }
  const urls: Partial<Record<typeof URL_FIELDS[number], { slot: string; query: string }>> = {}
  for (const field of URL_FIELDS) {
    if (body[field] === undefined) continue
    const parsed = placeholder(body[field])
    if (!parsed) return null
    urls[field] = parsed
  }
  let remote: { mcp: { slot: string; query: string }; ci?: { slot: string; query: string }; agentName: string; policySummary?: string; projectMachines?: string[] } | undefined
  if (body.remote !== undefined) {
    const value = body.remote as Record<string, unknown> | null
    if (!value || typeof value !== 'object') return null
    const mcp = placeholder(value.mcpUrl)
    const ci = value.ciMcpUrl === undefined ? undefined : placeholder(value.ciMcpUrl)
    if (!mcp || ci === null || !short(value.agentName, 200)) return null
    if (value.policySummary !== undefined && !short(value.policySummary, 8000)) return null
    const machines = value.projectMachines
    if (machines !== undefined && (!Array.isArray(machines) || machines.length > 50 || !machines.every((name) => short(name, 200)))) return null
    remote = { mcp, ...(ci ? { ci } : {}), agentName: value.agentName,
      ...(typeof value.policySummary === 'string' ? { policySummary: value.policySummary } : {}),
      ...(Array.isArray(machines) ? { projectMachines: machines as string[] } : {}) }
  }
  const sources: { name: string; conversationId: string; mode: 'whole_project' | 'files'; paths: string[]; mcp: { slot: string; query: string } }[] = []
  if (body.makeSources !== undefined) {
    if (!Array.isArray(body.makeSources) || body.makeSources.length > 10) return null
    for (const item of body.makeSources as Record<string, unknown>[]) {
      const mcp = item && typeof item === 'object' ? placeholder(item.mcpUrl) : null
      if (!mcp || typeof item.name !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(item.name) || !short(item.conversationId, 128)) return null
      if (!Array.isArray(item.paths) || item.paths.length > 200 || !item.paths.every((path) => short(path, 1024))) return null
      sources.push({ name: item.name, conversationId: item.conversationId, mode: item.mode === 'whole_project' ? 'whole_project' : 'files', paths: item.paths as string[], mcp })
    }
  }
  const disallowed = body.disallowedTools
  if (disallowed !== undefined && (!Array.isArray(disallowed) || disallowed.length > 400 || !disallowed.every((tool) => typeof tool === 'string' && /^[\w:.-]{1,160}$/.test(tool)))) return null
  if (body.permissionMode !== undefined && !PERMISSION_MODES.includes(String(body.permissionMode))) return null
  if (!slots.length || new Set(slots).size !== slots.length) return null
  return {
    slots,
    build: (url) => ({
      // Only the application's MCP tools: no shell, file or web tool of the runner itself.
      toolOnly: true,
      ...(remote ? {} : { executionDisabled: true }),
      ...Object.fromEntries(URL_FIELDS.flatMap((field) => urls[field] ? [[field, url(urls[field]!)]] : [])),
      ...(remote ? { remote: { mcpUrl: url(remote.mcp), agentName: remote.agentName,
        ...(remote.ci ? { ciMcpUrl: url(remote.ci) } : {}),
        ...(remote.policySummary ? { policySummary: remote.policySummary } : {}),
        ...(remote.projectMachines ? { projectMachines: remote.projectMachines } : {}) } } : {}),
      ...(sources.length ? { makeSources: sources.map(({ mcp, ...source }) => ({ ...source, mcpUrl: url(mcp) })) } : {}),
      ...(body.kbMode === 'auto' || body.kbMode === 'manual' ? { kbMode: body.kbMode } : {}),
      ...(body.previewSurface === 'panel' || body.previewSurface === 'chromium' || body.previewSurface === 'make-preview' ? { previewSurface: body.previewSurface } : {}),
      ...(body.readOnlyRemote === true ? { readOnlyRemote: true } : {}),
      ...(Array.isArray(disallowed) ? { disallowedTools: disallowed as string[] } : {}),
      ...(typeof body.permissionMode === 'string' ? { permissionMode: body.permissionMode } : {})
    })
  }
}
