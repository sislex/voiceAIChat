import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { BrowserCommand, BrowserSessionMetadata } from '@voicechat/shared'
import { externalStandUrl, resolveExternalStand, type StandLookup } from '../standExternal.js'

// Stand research for the Make assistant: `userStand { op: 'research' }` opens a stand URL in a
// headless browser-runner session of the Make conversation (one tab per stand) and runs one
// read-only runner `research` command there (tree, styles, screenshot, network, resource). The tab
// opens the stand URL when it is new or on `reload`; `navigate` opens another page of the stand.
// Runner wire: `{ type: 'research', action }` from browser-contracts `browserResearch`.

export const STAND_RESEARCH_RESOURCE_MAX_BYTES = 10 * 1024 * 1024
const element = z.string().trim().min(1).max(1000)
export const standResearchActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tree'), selector: element.optional(), depth: z.number().int().min(0).max(30).optional(), limit: z.number().int().min(1).max(1500).optional(), hidden: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('styles'), element, depth: z.number().int().min(0).max(4).optional(), limit: z.number().int().min(1).max(60).optional() }).strict(),
  z.object({ kind: z.literal('screenshot'), element: element.optional(), fullPage: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('network'), filter: z.string().max(300).optional(), limit: z.number().int().min(1).max(1000).optional() }).strict(),
  z.object({ kind: z.literal('resource'), url: z.string().min(1).max(4000), as: z.enum(['text', 'base64']).optional(), maxBytes: z.number().int().min(1).max(STAND_RESEARCH_RESOURCE_MAX_BYTES).optional() }).strict(),
])
export const standResearchOperationSchema = z.object({
  op: z.literal('research'),
  /** Make conversation: the browser session is per user and conversation. */
  conversationId: z.string().min(1).max(200),
  /** Stand key inside the conversation (stand id); each stand has its own tab. */
  stand: z.string().min(1).max(200),
  /** Stand URL: opened when the stand's tab is new or with `reload`. */
  url: z.string().min(1).max(4000).nullable(),
  /** Open this URL in the stand's tab now (a page of the stand the user named). */
  navigate: z.string().min(1).max(4000).optional(),
  reload: z.boolean().optional(),
  action: standResearchActionSchema,
}).strict()
export type StandResearchOperation = z.infer<typeof standResearchOperationSchema>
export type StandResearchAction = z.infer<typeof standResearchActionSchema>
/** Runner result as is: `{ ok: true, kind, ... }` or `{ ok: false, error }`, plus the tab URL. */
export const standResearchResultSchema = z.object({ research: z.record(z.string(), z.unknown()) }).strict()
export type StandResearchResult = z.infer<typeof standResearchResultSchema>

/** Narrow runner client: `research` travels next to the shared BrowserCommand union. */
export interface StandResearchRunner {
  start(input: { sessionId: string; userKey: string; conversationKey: string; profileMode?: 'ephemeral' }): Promise<BrowserSessionMetadata>
  command(sessionId: string, request: { requestId: string; incarnation: string; actor: 'assistant'; tabId?: string; command: BrowserCommand }): Promise<unknown>
}

interface SessionState { incarnation: string; tabs: Map<string, string>; queue: Promise<unknown> }

function forbidden(): never { throw Object.assign(new Error('stand_url_forbidden'), { statusCode: 403 }) }
function unavailable(message = 'stand_research_unavailable'): never { throw Object.assign(new Error(message), { statusCode: 503 }) }

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host)
}

export class StandResearch {
  private readonly sessions = new Map<string, SessionState>()
  private seq = 0
  constructor(private readonly deps: {
    runner: () => StandResearchRunner | undefined
    /**
     * `VC_STAND_RESEARCH_ALLOW_LOOPBACK=1`: Core and its browser-runner run on the user's machine, so
     * localhost stands may be researched. Server deployments keep the external-stand SSRF guard.
     */
    allowLoopback?: boolean
    guard?: { lookup?: StandLookup; allowPrivate?: boolean }
  }) {}

  /** Every URL Core hands to the runner passes the external-stand guard (loopback only by switch). */
  private async guard(raw: string): Promise<string> {
    const url = externalStandUrl(raw)
    const loopback = this.deps.allowLoopback ?? process.env.VC_STAND_RESEARCH_ALLOW_LOOPBACK === '1'
    if (!(loopback && isLoopback(url.hostname))) await resolveExternalStand(url.href, this.deps.guard)
    return url.href
  }

  private key(user: string, conversationId: string): string {
    return 'make-research-' + createHash('sha256').update(JSON.stringify([user, conversationId])).digest('hex').slice(0, 40)
  }

  /** Runner calls of one session are serialized: tab selection and the command must not interleave. */
  async research(user: string, operation: StandResearchOperation): Promise<StandResearchResult> {
    const op = standResearchOperationSchema.parse(operation)
    const runner = this.deps.runner()
    if (!runner) unavailable()
    const sessionId = this.key(user, op.conversationId)
    const state = this.sessions.get(sessionId) ?? { incarnation: '', tabs: new Map(), queue: Promise.resolve() }
    this.sessions.set(sessionId, state)
    const run = state.queue.catch(() => undefined).then(() => this.run(runner, user, sessionId, state, op))
    state.queue = run
    return run
  }

  private async run(runner: StandResearchRunner, user: string, sessionId: string, state: SessionState, op: StandResearchOperation): Promise<StandResearchResult> {
    const standUrl = op.url === null ? null : await this.guard(op.url)
    const navigate = op.navigate === undefined ? null : await this.guard(op.navigate)
    for (let attempt = 0; ; attempt++) {
      try {
        if (!state.incarnation) {
          const meta = await runner.start({ sessionId, userKey: user, conversationKey: 'make-research:' + op.conversationId, profileMode: 'ephemeral' })
          state.incarnation = meta.incarnation
          state.tabs.clear()
        }
        const send = (command: BrowserCommand, tabId?: string) =>
          runner.command(sessionId, { requestId: `${sessionId}-${++this.seq}`, incarnation: state.incarnation, actor: 'assistant', ...(tabId ? { tabId } : {}), command })
        let tabId = state.tabs.get(op.stand)
        const fresh = !tabId
        if (!tabId) {
          const meta = await send({ type: 'newTab' }) as BrowserSessionMetadata
          if (!meta.activeTabId) unavailable('stand_research_no_tab')
          tabId = meta.activeTabId
          state.tabs.set(op.stand, tabId)
        }
        const target = navigate ?? (fresh || op.reload ? standUrl : null)
        if (target) await send({ type: 'navigate', url: target }, tabId)
        const action = op.action.kind === 'resource' ? { ...op.action, url: await this.guard(await this.absolute(send, tabId, op.action.url)) } : op.action
        const research = await send({ type: 'research', action } as unknown as BrowserCommand, tabId) as Record<string, unknown>
        return { research }
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        // Runner restart or idle sweep: start a fresh session once; a closed tab is reopened once.
        if (attempt === 0 && /stale_incarnation|not_found|not_ready/.test(message)) { state.incarnation = ''; continue }
        if (attempt === 0 && /stale_tab/.test(message)) { state.tabs.delete(op.stand); continue }
        if ((error as { statusCode?: number }).statusCode) throw error
        const status = (error as { status?: number }).status
        throw Object.assign(new Error(message || 'stand_research_failed'), { statusCode: status === 404 || status === 409 ? 409 : status && status >= 400 && status < 500 ? 422 : 502 })
      }
    }
  }

  /** Relative resource URLs resolve against the tab's current page. */
  private async absolute(send: (command: BrowserCommand, tabId?: string) => Promise<unknown>, tabId: string, raw: string): Promise<string> {
    if (/^https?:\/\//i.test(raw)) return raw
    const meta = await send({ type: 'status' }, tabId) as BrowserSessionMetadata
    const page = meta.tabs.find(item => item.id === tabId)?.url
    try { return new URL(raw, page).href } catch { forbidden() }
  }
}
