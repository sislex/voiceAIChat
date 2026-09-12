// `ReaderCore` для отдельного процесса ридера: состояние ядра — по RPC `/internal/reader/core`. Действие в
// панели ждёт клиента до `PREVIEW_ACTION_TIMEOUT_MS` у ядра, поэтому таймаут RPC берётся с запасом сверху;
// кадр проверки — тело до нескольких мегабайт, ему тоже нужен долгий вызов.
import { createRpcClient } from '@voicechat/shared'
import type { PreviewAction, PreviewEnvironment, ReaderProjectRequest, ReaderProjectResponse } from '@voicechat/shared'
import { PREVIEW_ACTION_TIMEOUT_MS, type PreviewActionOutcome } from './actions.js'
import type { ReaderCore, ReaderContext } from './core.js'
import type { PreviewToolEntry } from './turnToken.js'
import type { AgentHttpRequest, AgentHttpResponse } from '@voicechat/shared'
import { INTERNAL_READER_CORE_PATH } from './internal.js'

export interface HttpReaderCoreOptions {
  coreUrl: string
  token: string
  fetchImpl?: typeof fetch
}

type Rpc = <T>(method: string, ...args: unknown[]) => Promise<T>

/** Хвостовые `undefined` в JSON превращаются в `null` — не передаём их вовсе, чтобы у ядра сработали значения по умолчанию. */
function trim(args: unknown[]): unknown[] {
  let end = args.length
  while (end > 0 && args[end - 1] === undefined) end--
  return args.slice(0, end)
}

export class HttpReaderCore implements ReaderCore {
  private readonly fast: Rpc
  private readonly slow: Rpc

  constructor(private readonly opts: HttpReaderCoreOptions) {
    this.fast = this.client(15_000)
    this.slow = this.client(5 * 60_000)
  }

  private client(timeoutMs: number): Rpc {
    const rpc = createRpcClient({ baseUrl: this.opts.coreUrl, token: this.opts.token, path: INTERNAL_READER_CORE_PATH, timeoutMs, ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}) })
    return (method, ...args) => rpc(method, ...trim(args))
  }

  /** Ждём столько, сколько попросил вызывающий, плюс запас на сеть: таймаут — на каждый вызов свой. */
  previewAction(userId: string, conversationId: string, action: PreviewAction, timeoutMs?: number): Promise<PreviewActionOutcome> {
    return this.client((timeoutMs ?? PREVIEW_ACTION_TIMEOUT_MS) + 10_000)<PreviewActionOutcome>('previewAction', userId, conversationId, action, timeoutMs)
  }

  context(entry: PreviewToolEntry): Promise<ReaderContext | null> { return this.fast('context', entry) }
  canUseMachine(userId: string, agentId: string): Promise<boolean> { return this.fast('canUseMachine', userId, agentId) }
  machineOnline(agentId: string): Promise<boolean> { return this.fast('machineOnline', agentId) }
  machineHttp(userId: string, agentId: string, request: AgentHttpRequest): Promise<AgentHttpResponse> { return this.slow('machineHttp', userId, agentId, request) }

  projectResource(request: ReaderProjectRequest): Promise<ReaderProjectResponse> {
    return this.fast<ReaderProjectResponse>('projectResource', request)
  }

  issuePreviewRunKey(userId: string): Promise<string> {
    return this.fast<string>('issuePreviewRunKey', userId)
  }

  listPreviews(): Promise<PreviewEnvironment[]> {
    return this.fast<PreviewEnvironment[]>('listPreviews')
  }

  async logBrowserEvidence(entry: PreviewToolEntry, event: import('@voicechat/shared').CiBrowserEvidenceEvent): Promise<void> {
    await this.fast('logBrowserEvidence', entry, event)
  }

  async logBrowserShot(userId: string, conversationId: string, pngBase64: string): Promise<void> {
    await this.slow('logBrowserShot', userId, conversationId, pngBase64)
  }
}
