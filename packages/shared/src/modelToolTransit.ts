// Tool transit of the model API. An application that uses the models of another Core (the provider)
// keeps its own tools and chat context: the provider adds none and executes none. The model runs on
// the provider's runner, so a tool call has to travel back to the application. The application holds
// one outgoing WebSocket to the provider; the provider gives the runner its own address for every
// MCP endpoint the application declared for a run and relays each HTTP request over that socket.

import { MODEL_RUNNER_API_PREFIX } from './protocol'

export const MODEL_TOOL_TRANSIT = {
  /** WebSocket of the application, authorised like every model API request. */
  socket: MODEL_RUNNER_API_PREFIX + 'transit',
  /** Runner-facing address of a declared endpoint: `<base><http>/<run token>/<slot>`. */
  http: '/mcp/transit',
  /** Placeholder the application sends instead of its own address: `transit:<slot>[?make=1]`. */
  scheme: 'transit:'
} as const

export const MODEL_TOOL_TRANSIT_LIMITS = {
  /** Declared endpoints of one run. */
  slots: 24,
  requestBytes: 4 * 1024 * 1024,
  responseBytes: 16 * 1024 * 1024,
  /** A remote command may run for five minutes; the relay waits a little longer. */
  callTimeoutMs: 330_000,
  callsPerRun: 2000,
  concurrentCallsPerRun: 16
} as const

/** Request headers a relay forwards; everything else stays on its own hop. */
export const MODEL_TOOL_TRANSIT_REQUEST_HEADERS = ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'] as const
export const MODEL_TOOL_TRANSIT_RESPONSE_HEADERS = ['content-type', 'mcp-session-id', 'cache-control', 'allow'] as const

/** Frames from the provider to the application. */
export type ModelToolTransitProviderFrame =
  | { t: 'ready'; id: string }
  | { t: 'req'; call: string; slot: string; method: string; headers: Record<string, string>; body?: string }
  | { t: 'abort'; call: string }

/** Frames from the application to the provider; bodies are base64. */
export type ModelToolTransitApplicationFrame =
  | { t: 'head'; call: string; status: number; headers: Record<string, string> }
  | { t: 'chunk'; call: string; data: string }
  | { t: 'end'; call: string }
  | { t: 'err'; call: string; message: string }

const SLOT = /^[A-Za-z0-9_-]{8,64}$/

export function isModelToolTransitSlot(value: unknown): value is string {
  return typeof value === 'string' && SLOT.test(value)
}

/** `transit:<slot>` with an optional query made of plain flags; anything else is not a placeholder. */
export function parseModelToolTransitPlaceholder(value: unknown): { slot: string; query: string } | null {
  if (typeof value !== 'string' || !value.startsWith(MODEL_TOOL_TRANSIT.scheme)) return null
  const rest = value.slice(MODEL_TOOL_TRANSIT.scheme.length)
  const cut = rest.indexOf('?')
  const slot = cut < 0 ? rest : rest.slice(0, cut)
  const query = cut < 0 ? '' : rest.slice(cut + 1)
  if (!isModelToolTransitSlot(slot) || !/^[A-Za-z0-9_=&-]{0,64}$/.test(query)) return null
  return { slot, query }
}

export function modelToolTransitPlaceholder(slot: string, query = ''): string {
  return MODEL_TOOL_TRANSIT.scheme + slot + (query ? '?' + query : '')
}

function headers(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, string> = {}
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== 'string' || item.length > 4096) return null
    out[name.toLowerCase()] = item
  }
  return out
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

export function parseModelToolTransitProviderFrame(raw: string): ModelToolTransitProviderFrame | null {
  const frame = parse(raw)
  if (!frame) return null
  if (frame.t === 'ready') return text(frame.id, 128) ? { t: 'ready', id: frame.id } : null
  if (frame.t === 'abort') return text(frame.call, 128) ? { t: 'abort', call: frame.call } : null
  if (frame.t === 'req') {
    const head = headers(frame.headers)
    if (!text(frame.call, 128) || !isModelToolTransitSlot(frame.slot) || !text(frame.method, 16) || !head) return null
    if (frame.body !== undefined && typeof frame.body !== 'string') return null
    return { t: 'req', call: frame.call, slot: frame.slot, method: frame.method, headers: head, ...(frame.body !== undefined ? { body: frame.body } : {}) }
  }
  return null
}

export function parseModelToolTransitApplicationFrame(raw: string): ModelToolTransitApplicationFrame | null {
  const frame = parse(raw)
  if (!frame || !text(frame.call, 128)) return null
  if (frame.t === 'head') {
    const head = headers(frame.headers)
    return Number.isInteger(frame.status) && (frame.status as number) >= 100 && (frame.status as number) <= 599 && head
      ? { t: 'head', call: frame.call, status: frame.status as number, headers: head } : null
  }
  if (frame.t === 'chunk') return typeof frame.data === 'string' ? { t: 'chunk', call: frame.call, data: frame.data } : null
  if (frame.t === 'end') return { t: 'end', call: frame.call }
  if (frame.t === 'err') return { t: 'err', call: frame.call, message: typeof frame.message === 'string' ? frame.message.slice(0, 500) : '' }
  return null
}
