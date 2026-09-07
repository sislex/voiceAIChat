// `KanbanCore` для отдельного процесса канбана: состояние ядра — по HTTP. Синхронные чтения о машинах
// отвечает зеркало (`MachinesMirror`), которое ядро наполняет пушем; команды машин идут потоковым
// эндпоинтом; остальное — RPC `/internal/kanban/core`. Обратные вызовы тоннелей (авторизация
// подключения, закрытие) остаются здесь и вызываются ядром по RPC `/internal/service`.
import { createRpcClient } from '@voicechat/shared'
import type { EnsureProjectMainCurrent, KanbanCore, KanbanMachines, KanbanUploads, KanbanWidgets } from '../core.js'
import type { KbView, KnowledgeBaseService } from '../../kb/types.js'
import { INTERNAL_KANBAN_CORE_PATH, INTERNAL_KANBAN_EXEC_STREAM_PATH, type MachineSnapshot } from '../internal.js'
import { execOverHttp } from '../../internal/execStream.js'
import { MachinesMirror } from './machinesMirror.js'

export interface HttpKanbanCoreOptions {
  coreUrl: string
  token: string
  fetchImpl?: typeof fetch
  /** Куда писать об ошибке фонового вызова (без ожидания ответа). */
  onError?: (error: unknown, what: string) => void
}

type Rpc = <T>(method: string, ...args: unknown[]) => Promise<T>
type UiRequest = KanbanWidgets['ui']['request']

/** Хвостовые `undefined` в JSON превращаются в `null` — не передаём их вовсе, чтобы у ядра сработали значения по умолчанию. */
function trim(args: unknown[]): unknown[] {
  let end = args.length
  while (end > 0 && args[end - 1] === undefined) end--
  return args.slice(0, end)
}

export class HttpKanbanCore implements KanbanCore {
  readonly mirror = new MachinesMirror()
  readonly machines: KanbanMachines
  readonly kb: KnowledgeBaseService
  readonly uploads: KanbanUploads
  readonly widgets: KanbanWidgets
  readonly ensureProjectMainCurrent: EnsureProjectMainCurrent
  /** Обратные вызовы тоннелей, созданных через ядро: ядро спрашивает их по RPC `authorizeTunnel`/`tunnelClosed`. */
  readonly tunnels = {
    authorize: async (id: string): Promise<boolean> => (await this.tunnelCallbacks.get(id)?.authorize()) ?? false,
    closed: async (id: string): Promise<void> => { const cb = this.tunnelCallbacks.get(id); this.tunnelCallbacks.delete(id); await cb?.onClose?.() }
  }
  private readonly tunnelCallbacks = new Map<string, { authorize: () => Promise<boolean>; onClose?: () => Promise<void> }>()
  /** Быстрые вызовы (KB, вложения, снимок виджета) и долгие (файлы машины, тоннели, git, подтверждение в UI до 5 мин). */
  private readonly rpc: Rpc
  private readonly slow: Rpc

  constructor(private readonly opts: HttpKanbanCoreOptions) {
    const base = { baseUrl: opts.coreUrl, token: opts.token, path: INTERNAL_KANBAN_CORE_PATH, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) }
    const fast = createRpcClient({ ...base, timeoutMs: 15_000 })
    const slow = createRpcClient({ ...base, timeoutMs: 10 * 60_000 })
    this.rpc = (method, ...args) => fast(method, ...trim(args))
    this.slow = (method, ...args) => slow(method, ...trim(args))
    const background = (what: string) => (error: unknown): void => { this.opts.onError?.(error, what) }
    const mirror = this.mirror
    const stream = { baseUrl: opts.coreUrl, token: opts.token, path: INTERNAL_KANBAN_EXEC_STREAM_PATH }
    this.machines = {
      isOnline: (id) => mirror.isOnline(id),
      nameOf: (id) => mirror.nameOf(id),
      platformOf: (id) => mirror.platformOf(id),
      policyOf: (id) => mirror.policyOf(id),
      telemetryOf: (id) => mirror.telemetryOf(id),
      exec: (agentId, command, timeoutMs, signal, meta) => execOverHttp(stream, { agentId, command, timeoutMs, stream: false, ...(meta ? { meta } : {}) }, undefined, signal),
      execStream: (agentId, command, timeoutMs, onChunk, signal) => execOverHttp(stream, { agentId, command, timeoutMs, stream: true }, onChunk, signal),
      fsRead: (agentId, path) => this.slow('machines.fsRead', agentId, path),
      fsWrite: (agentId, path, dataBase64) => this.slow('machines.fsWrite', agentId, path, dataBase64),
      fsMkdir: (agentId, path) => this.slow('machines.fsMkdir', agentId, path),
      fsDelete: (agentId, path) => this.slow('machines.fsDelete', agentId, path),
      fsRename: (agentId, from, to) => this.slow('machines.fsRename', agentId, from, to),
      gitAccess: (agentId, request) => this.slow('machines.gitAccess', agentId, request),
      createTunnel: async (id, sourceAgentId, targetAgentId, targetPort, authorize, onClose) => {
        this.tunnelCallbacks.set(id, { authorize: authorize ?? (async () => true), ...(onClose ? { onClose } : {}) })
        try { return await this.slow<number>('machines.createTunnel', id, sourceAgentId, targetAgentId, targetPort) } catch (error) { this.tunnelCallbacks.delete(id); throw error }
      },
      closeTunnel: (id) => this.rpc<boolean>('machines.closeTunnel', id),
      closeTunnelsForTarget: (agentId) => { void this.rpc('machines.closeTunnelsForTarget', agentId).catch(background('closeTunnelsForTarget')) }
    }
    this.kb = {
      status: () => this.rpc('kb.status'),
      topics: (view?: KbView) => this.rpc('kb.topics', view),
      document: (id, view?: KbView) => this.rpc('kb.document', id, view),
      search: (request, view?: KbView) => this.rpc('kb.search', request, view),
      context: (query, budget?: number, view?: KbView) => this.rpc('kb.context', query, budget, view)
    }
    this.uploads = { get: async (id) => (await this.rpc<Awaited<ReturnType<KanbanUploads['get']>> | null>('uploads.get', id)) ?? undefined }
    this.widgets = {
      contexts: {
        surface: (conversationId) => this.rpc('widgets.surface', conversationId),
        updateSurface: (conversationId, surface) => { void this.rpc('widgets.updateSurface', conversationId, surface).catch(background('updateSurface')) }
      },
      ui: { request: ((...args: Parameters<UiRequest>) => this.slow('widgets.uiRequest', ...args)) as UiRequest }
    }
    this.ensureProjectMainCurrent = (args) => this.slow('ensureProjectMainCurrent', args)
  }

  /** Первичное заполнение зеркала машин — до регистрации роутов, чтобы автопилот не считал всех offline. */
  async start(): Promise<void> {
    this.mirror.apply(await this.rpc<MachineSnapshot[]>('machines.snapshot'))
  }
}
