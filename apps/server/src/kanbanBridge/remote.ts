// `KanbanService` для ядра в режиме `remote`: канбан живёт отдельным процессом. Снимок рана и
// `boardChanged` — RPC к канбану (`/internal/service`); кадры ранов, события доски и уведомлений
// приходят от канбана пачками в локальные ленты (`apply`) — сокеты пользователей живут у ядра, и
// подписки остаются синхронными, как во встроенном режиме. Здесь же — обратные вызовы тоннелей,
// которыми ядро спрашивает канбан при подключении к тоннелю превью.
import type { ServerMessage } from '@voicechat/shared'
import { createRpcClient } from '@voicechat/shared'
import type { KanbanService } from '../kanban/service.js'
import { KANBAN_INTERNAL_MACHINES_PATH, KANBAN_INTERNAL_SERVICE_PATH, type KanbanEvent, type MachineSnapshot, type MachinesSnapshotRequest } from '../kanban/internal.js'

export interface RemoteKanbanOptions {
  kanbanUrl: string
  token: string
  fetchImpl?: typeof fetch
  /** Куда писать об ошибке фонового вызова (`boardChanged`, пуш машин). */
  onError?: (error: unknown, what: string) => void
}

export interface RemoteKanban {
  service: KanbanService
  /** Событие от процесса канбана — воспроизвести на лентах ядра. */
  apply(event: KanbanEvent): void
  /** Снимок онлайн-машин — в зеркало канбана. */
  pushMachines(machines: MachineSnapshot[]): Promise<void>
  /** Обратные вызовы тоннелей, созданных канбаном через ядро. */
  tunnels: { authorize(id: string): Promise<boolean>; closed(id: string): Promise<void> }
}

class Listeners<T extends unknown[]> {
  private readonly set = new Set<(...args: T) => unknown>()
  add(cb: (...args: T) => unknown): () => void { this.set.add(cb); return () => { this.set.delete(cb) } }
  emit(...args: T): void { for (const cb of this.set) { try { void cb(...args) } catch { /* слушатель не должен ронять ленту */ } } }
}

export function createRemoteKanban(opts: RemoteKanbanOptions): RemoteKanban {
  const fetchImpl = opts.fetchImpl ?? fetch
  const rpc = createRpcClient({ baseUrl: opts.kanbanUrl, token: opts.token, fetchImpl, path: KANBAN_INTERNAL_SERVICE_PATH })
  const frames = new Listeners<[ServerMessage, string]>()
  const board = new Listeners<[string]>()
  const preparationRuns = new Listeners<[{ userId: string; projectId: string; taskId: string; runId: string }]>()
  const taskRepositories = new Listeners<[{ projectId: string; taskId: string }]>()
  const qaStages = new Listeners<[{ projectId: string; taskId: string; stage: import('@voicechat/shared').QaRunStage }]>()
  const improvements = new Listeners<[string]>()
  const notifications = new Listeners<[{ projectId: string; userId?: string; kind?: 'membership' }]>()

  const service: KanbanService = {
    runs: {
      subscribe: (listener) => frames.add(listener),
      snapshot: (userId, runId) => rpc<ServerMessage | null>('snapshot', userId, runId).then((m) => m ?? undefined)
    },
    board: {
      changed: (projectId) => { void rpc('boardChanged', projectId).catch((error) => opts.onError?.(error, 'boardChanged')) },
      subscribe: (cb) => board.add(cb),
      subscribePreparationRuns: (cb) => preparationRuns.add(cb),
      subscribeTaskRepositories: (cb) => taskRepositories.add(cb),
      subscribeQaStages: (cb) => qaStages.add(cb),
      subscribeImprovements: (cb) => improvements.add(cb)
    },
    notifications: { subscribe: (cb) => notifications.add(cb) }
  }

  return {
    service,
    apply(event) {
      switch (event.kind) {
        case 'frame': frames.emit(event.message, event.userId); break
        case 'board': board.emit(event.projectId); break
        case 'preparationRun': preparationRuns.emit(event.update); break
        case 'taskRepositories': taskRepositories.emit(event.update); break
        case 'qaStage': qaStages.emit(event.update); break
        case 'improvements': improvements.emit(event.projectId); break
        case 'notification': notifications.emit(event.event); break
      }
    },
    async pushMachines(machines) {
      const res = await fetchImpl(`${opts.kanbanUrl.replace(/\/+$/, '')}${KANBAN_INTERNAL_MACHINES_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
        body: JSON.stringify({ machines } satisfies MachinesSnapshotRequest),
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) throw new Error(`kanban machines push: HTTP ${res.status}`)
    },
    tunnels: {
      authorize: (id) => rpc<boolean>('authorizeTunnel', id),
      closed: async (id) => { await rpc('tunnelClosed', id) }
    }
  }
}
