import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import type {
  CcItem,
  CcProject,
  CcSession,
  CxItem,
  CxProject,
  CxSession,
  LoginStatusMap,
  SessionUsage
} from '@voicechat/shared'

export interface RunnerFileContent {
  name: string
  dataBase64: string
}

interface TranscriptResponse<T> {
  items: T[]
  usage: SessionUsage
}

interface SsePayload<T> {
  items: T[]
}

export interface RunnerFsClientOptions {
  claudeBaseUrl?: string
  codexBaseUrl?: string
  token?: string
  fetchImpl?: typeof fetch
  reconnectDelayMs?: number
}

class RunnerHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message)
  }
}

const CC_PROJECTS_PATH = '/v1/fs/cc/projects'
const CC_WATCH_PATH = '/v1/fs/cc/watch'
const CX_PROJECTS_PATH = '/v1/fs/cx/projects'
const CX_SESSIONS_PATH = '/v1/fs/cx/sessions'
const CX_TRANSCRIPT_PATH = '/v1/fs/cx/transcript'
const CX_WATCH_PATH = '/v1/fs/cx/watch'
const AUTH_STATUS_PATH = '/v1/auth/status'
const FILE_READ_PATH = '/v1/files/read'

function baseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

function looksLikeCodexPath(path: string): boolean {
  return /(^|[/\\])\.codex([/\\]|$)/.test(path)
}

function looksLikeClaudePath(path: string): boolean {
  return /(^|[/\\])\.claude([/\\]|$)/.test(path)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeRunnerError(err: unknown): string {
  if (err instanceof RunnerHttpError) {
    return `исполнитель вернул ${err.status}${err.body ? `: ${err.body.slice(0, 200)}` : ''}`
  }
  return err instanceof Error ? err.message : String(err)
}

export class RunnerFsClient {
  private readonly fetchImpl: typeof fetch
  private readonly reconnectDelayMs: number

  constructor(private readonly opts: RunnerFsClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 500
  }

  async authStatus(userId: string): Promise<LoginStatusMap> {
    const claudeUrl = this.claudeUrl()
    const codexUrl = this.codexUrl()
    if (claudeUrl && codexUrl && claudeUrl !== codexUrl) {
      const [claude, codex] = await Promise.all([
        this.getJson<LoginStatusMap>(claudeUrl, AUTH_STATUS_PATH, { userId }),
        this.getJson<LoginStatusMap>(codexUrl, AUTH_STATUS_PATH, { userId })
      ])
      return { claude: claude.claude, codex: codex.codex }
    }
    const url = claudeUrl ?? codexUrl
    if (!url) throw new Error('адрес исполнителя не настроен')
    return this.getJson<LoginStatusMap>(url, AUTH_STATUS_PATH, { userId })
  }

  listCcProjects(userId: string): Promise<CcProject[]> {
    return this.getJson(this.requireClaudeUrl(), CC_PROJECTS_PATH, { userId })
  }

  listCcSessions(userId: string, slug: string): Promise<CcSession[]> {
    return this.getJson(this.requireClaudeUrl(), `/v1/fs/cc/projects/${encodeURIComponent(slug)}/sessions`, { userId })
  }

  readCcTranscript(userId: string, slug: string, id: string, limit?: number): Promise<TranscriptResponse<CcItem>> {
    return this.getJson(
      this.requireClaudeUrl(),
      `/v1/fs/cc/projects/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(id)}`,
      { userId, ...(limit ? { limit: String(limit) } : {}) }
    )
  }

  listCxProjects(userId: string): Promise<CxProject[]> {
    return this.getJson(this.requireCodexUrl(), CX_PROJECTS_PATH, { userId })
  }

  listCxSessions(userId: string, cwd: string): Promise<CxSession[]> {
    return this.getJson(this.requireCodexUrl(), CX_SESSIONS_PATH, { userId, cwd })
  }

  readCxTranscript(userId: string, id: string, limit?: number): Promise<TranscriptResponse<CxItem>> {
    return this.getJson(this.requireCodexUrl(), CX_TRANSCRIPT_PATH, {
      userId,
      id,
      ...(limit ? { limit: String(limit) } : {})
    })
  }

  watchCc(userId: string, slug: string, id: string, onItems: (items: CcItem[]) => void): () => void {
    return this.watch(this.requireClaudeUrl(), CC_WATCH_PATH, { userId, slug, id }, onItems)
  }

  watchCx(userId: string, id: string, onItems: (items: CxItem[]) => void): () => void {
    return this.watch(this.requireCodexUrl(), CX_WATCH_PATH, { userId, id }, onItems)
  }

  async readFile(userId: string, path: string): Promise<RunnerFileContent | null> {
    const candidates = this.fileCandidates(path)
    let firstError: unknown = null
    for (const url of candidates) {
      try {
        return await this.getMaybeJson<RunnerFileContent>(url, FILE_READ_PATH, { userId, path })
      } catch (err) {
        if (err instanceof RunnerHttpError && err.status === 404) continue
        firstError ??= err
      }
    }
    if (firstError) throw new Error(`не удалось прочитать файл из исполнителя: ${describeRunnerError(firstError)}`)
    return null
  }

  private claudeUrl(): string | undefined {
    return this.opts.claudeBaseUrl ? baseUrl(this.opts.claudeBaseUrl) : undefined
  }

  private codexUrl(): string | undefined {
    return this.opts.codexBaseUrl ? baseUrl(this.opts.codexBaseUrl) : undefined
  }

  private requireClaudeUrl(): string {
    return this.claudeUrl() ?? this.codexUrl() ?? this.missing('Claude')
  }

  private requireCodexUrl(): string {
    return this.codexUrl() ?? this.claudeUrl() ?? this.missing('Codex')
  }

  private missing(kind: string): never {
    throw new Error(`адрес исполнителя ${kind} не настроен`)
  }

  private fileCandidates(path: string): string[] {
    const out: string[] = []
    const push = (url: string | undefined) => {
      if (!url || out.includes(url)) return
      out.push(url)
    }
    if (looksLikeCodexPath(path)) {
      push(this.codexUrl())
      push(this.claudeUrl())
      return out
    }
    if (looksLikeClaudePath(path)) {
      push(this.claudeUrl())
      push(this.codexUrl())
      return out
    }
    push(this.codexUrl())
    push(this.claudeUrl())
    return out
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.opts.token
      ? { authorization: `Bearer ${this.opts.token}`, ...extra }
      : extra
  }

  private buildUrl(base: string, path: string, query: Record<string, string>): string {
    const url = new URL(path, `${base}/`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    return url.toString()
  }

  private async getJson<T>(base: string, path: string, query: Record<string, string>): Promise<T> {
    const res = await this.fetchImpl(this.buildUrl(base, path, query), {
      headers: this.headers({ accept: 'application/json' })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new RunnerHttpError(`executor ${res.status}`, res.status, body)
    }
    return res.json() as Promise<T>
  }

  private async getMaybeJson<T>(base: string, path: string, query: Record<string, string>): Promise<T | null> {
    const res = await this.fetchImpl(this.buildUrl(base, path, query), {
      headers: this.headers({ accept: 'application/json' })
    })
    if (res.status === 404) return null
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new RunnerHttpError(`executor ${res.status}`, res.status, body)
    }
    return res.json() as Promise<T>
  }

  private watch<T>(
    base: string,
    path: string,
    query: Record<string, string>,
    onItems: (items: T[]) => void
  ): () => void {
    let stopped = false
    let controller: AbortController | null = null
    let lastId: string | null = null

    const connect = async (): Promise<void> => {
      while (!stopped) {
        controller = new AbortController()
        try {
          const res = await this.fetchImpl(this.buildUrl(base, path, query), {
            headers: this.headers({
              accept: 'text/event-stream',
              ...(lastId ? { 'last-event-id': lastId } : {})
            }),
            signal: controller.signal
          })
          if (!res.ok || !res.body) {
            const body = await res.text().catch(() => '')
            throw new RunnerHttpError(`watch ${res.status}`, res.status, body)
          }
          await this.readSse(res.body, (eventId, data) => {
            if (eventId) lastId = eventId
            let parsed: SsePayload<T>
            try {
              parsed = JSON.parse(data) as SsePayload<T>
            } catch {
              return
            }
            if (Array.isArray(parsed.items) && parsed.items.length > 0) onItems(parsed.items)
          })
        } catch {
          if (stopped || controller.signal.aborted) break
        }
        if (!stopped) await delay(this.reconnectDelayMs)
      }
    }

    void connect()
    return () => {
      stopped = true
      controller?.abort()
    }
  }

  private async readSse(
    body: ReadableStream<Uint8Array>,
    onEvent: (id: string | null, data: string) => void
  ): Promise<void> {
    let eventId: string | null = null
    let data = ''
    const flush = () => {
      if (!data) return
      onEvent(eventId, data.slice(0, -1))
      eventId = null
      data = ''
    }
    const stream = Readable.fromWeb(body as never)
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (!line) {
        flush()
        continue
      }
      if (line.startsWith(':')) continue
      if (line.startsWith('id:')) {
        eventId = line.slice(3).trim()
        continue
      }
      if (line.startsWith('data:')) {
        data += `${line.slice(5).trimStart()}\n`
      }
    }
    flush()
  }
}
