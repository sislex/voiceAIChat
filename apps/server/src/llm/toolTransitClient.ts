// Application side of the model API tool transit (contract: packages/shared/src/modelToolTransit.ts).
//
// This Core uses the models of another Core. Its tools stay its own: before a run it replaces every
// MCP address of the request with an opaque `transit:<slot>` placeholder, and while the run lasts it
// answers the provider's relayed HTTP requests for those slots from its own local endpoints. The
// provider therefore never learns an address or a secret of this deployment.

import { randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import {
  MODEL_TOOL_TRANSIT, MODEL_TOOL_TRANSIT_LIMITS, modelToolTransitPlaceholder, parseModelToolTransitProviderFrame,
  type LlmRequest, type ModelToolTransitApplicationFrame
} from '@voicechat/shared'

export interface ToolTransitClientOptions {
  /** Base URL of the provider's model API, e.g. `https://core.example/api/model-runner`. */
  baseUrl: string
  token?: string
  fetchImpl?: typeof fetch
  /** Test seam: opens the socket. */
  connect?: (url: string, headers: Record<string, string>) => TransitClientSocket
  reconnectMs?: number
  log?: (event: string, detail?: Record<string, unknown>) => void
}

export interface TransitClientSocket {
  send(data: string): void
  close(): void
  on(event: 'open', listener: () => void): unknown
  on(event: 'message', listener: (data: unknown) => void): unknown
  on(event: 'close' | 'error', listener: (...args: unknown[]) => void): unknown
}

const URL_FIELDS = ['kbMcpUrl', 'historyMcpUrl', 'previewMcpUrl', 'consoleMcpUrl', 'makeMcpUrl', 'imageStudioMcpUrl', 'kanbanMcpUrl'] as const
const CHUNK_BYTES = 192 * 1024

/** `/api/model-runner` → the transit socket of the same provider. */
export function transitSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = MODEL_TOOL_TRANSIT.socket
  url.search = ''
  return url.toString()
}

export class ToolTransitClient {
  private socket: TransitClientSocket | null = null
  private id: string | null = null
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly slots = new Map<string, string>()
  private readonly calls = new Map<string, AbortController>()

  constructor(private readonly opts: ToolTransitClientOptions) {}

  /** True while the provider acknowledged this connection: a run may declare tools. */
  available(): boolean {
    return this.id !== null
  }

  start(): void {
    this.stopped = false
    this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.reset()
    try { this.socket?.close() } catch { /* already closed */ }
    this.socket = null
  }

  /**
   * Rewrites a run for the provider: MCP addresses become placeholders, the attachments stay here
   * (the model reads them through this deployment's own tools). Null — nothing to declare or the
   * transit is down; the caller then sends the request unchanged.
   */
  prepare(req: LlmRequest): { req: LlmRequest; release(): void } | null {
    const id = this.id
    if (!id || req.textOnly) return null
    const taken: string[] = []
    const slot = (url: string): string => {
      const name = randomBytes(18).toString('base64url')
      this.slots.set(name, url)
      taken.push(name)
      // The runner reads this one flag from the address; it carries no secret.
      let make = false
      try { make = new URL(url).searchParams.get('make') === '1' } catch { /* opaque address */ }
      return modelToolTransitPlaceholder(name, make ? 'make=1' : '')
    }
    const next: LlmRequest = { ...req }
    for (const field of URL_FIELDS) if (req[field]) next[field] = slot(req[field]!)
    if (req.remote) next.remote = { ...req.remote, mcpUrl: slot(req.remote.mcpUrl), ...(req.remote.ciMcpUrl ? { ciMcpUrl: slot(req.remote.ciMcpUrl) } : {}) }
    if (req.makeSources?.length) next.makeSources = req.makeSources.map((source) => ({ ...source, mcpUrl: slot(source.mcpUrl) }))
    if (!taken.length) return null
    delete next.attachments
    delete next.cwd
    next.toolOnly = true
    next.transit = { id }
    let released = false
    return { req: next, release: () => {
      if (released) return
      released = true
      for (const name of taken) this.slots.delete(name)
    } }
  }

  private open(): void {
    if (this.stopped) return
    const headers: Record<string, string> = this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}
    let socket: TransitClientSocket
    try {
      const url = transitSocketUrl(this.opts.baseUrl)
      socket = this.opts.connect ? this.opts.connect(url, headers) : new WebSocket(url, { headers, maxPayload: 48 * 1024 * 1024 }) as unknown as TransitClientSocket
    } catch { this.retry(); return }
    this.socket = socket
    socket.on('message', (data) => { if (this.socket === socket) void this.receive(socket, String(data)) })
    const closed = () => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.id) this.opts.log?.('tool_transit_closed')
      this.reset()
      this.retry()
    }
    socket.on('close', closed)
    // An older provider answers the upgrade with 404: `error` then `close` (or only `error`).
    socket.on('error', closed)
  }

  private reset(): void {
    this.id = null
    for (const controller of this.calls.values()) controller.abort()
    this.calls.clear()
  }

  private retry(): void {
    if (this.stopped || this.timer) return
    this.timer = setTimeout(() => { this.timer = null; this.open() }, this.opts.reconnectMs ?? 15_000)
    this.timer.unref?.()
  }

  private push(socket: TransitClientSocket, frame: ModelToolTransitApplicationFrame): void {
    try { socket.send(JSON.stringify(frame)) } catch { /* the close handler cleans up */ }
  }

  private async receive(socket: TransitClientSocket, raw: string): Promise<void> {
    const frame = parseModelToolTransitProviderFrame(raw)
    if (!frame) return
    if (frame.t === 'ready') {
      this.id = frame.id
      this.opts.log?.('tool_transit_ready')
      return
    }
    if (frame.t === 'abort') {
      this.calls.get(frame.call)?.abort()
      return
    }
    const call = frame.call
    // Only an address this deployment declared for a live run is ever called.
    const url = this.slots.get(frame.slot)
    if (!url) { this.push(socket, { t: 'err', call, message: 'unknown_slot' }); return }
    const controller = new AbortController()
    this.calls.set(call, controller)
    try {
      const body = frame.body ? Buffer.from(frame.body, 'base64') : undefined
      const response = await (this.opts.fetchImpl ?? fetch)(url, {
        method: frame.method, headers: frame.headers, redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(MODEL_TOOL_TRANSIT_LIMITS.callTimeoutMs)]),
        ...(body && frame.method !== 'GET' ? { body } : {})
      })
      const headers: Record<string, string> = {}
      response.headers.forEach((value, name) => { headers[name.toLowerCase()] = value })
      this.push(socket, { t: 'head', call, status: response.status, headers })
      if (response.body) {
        for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
          const data = Buffer.from(part)
          for (let at = 0; at < data.length; at += CHUNK_BYTES) {
            this.push(socket, { t: 'chunk', call, data: data.subarray(at, at + CHUNK_BYTES).toString('base64') })
          }
        }
      }
      this.push(socket, { t: 'end', call })
    } catch (error) {
      if (!controller.signal.aborted) this.push(socket, { t: 'err', call, message: error instanceof Error ? error.message : String(error) })
    } finally {
      this.calls.delete(call)
    }
  }
}
