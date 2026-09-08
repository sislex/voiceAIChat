// Внутренний протокол «ядро ↔ канбан» для режима двух процессов (docs/plans/kanban-service.md, круг 3).
// Контракт лежит на стороне кластера (как `internal.ts` у Make): ядро импортирует его, а не наоборот.
// Оба конца — Fastify под общим Bearer `VC_INTERNAL_TOKEN`; наружу Caddy эти пути не проксирует.
//
// У ядра: `KanbanCore` по RPC (`{ method, args }`, как у Make), поток вывода команды машины отдельным
// NDJSON-эндпоинтом (обратный вызов `onChunk` по сети иначе не передать) и приём событий кластера —
// кадров ранов, доски и уведомлений — для WS-сессий, которые живут у ядра.
// У канбана: `KanbanService` по RPC (снимок рана, `boardChanged` от соседей, обратные вызовы тоннелей)
// и приём снимка машин: онлайн-статус, имя, платформа, политика и телеметрия читаются кластером
// синхронно, поэтому в отдельном процессе их даёт зеркало, которое ядро обновляет пушем.
import type { AgentPolicy, AgentTelemetry, QaRunStage, ServerMessage } from '@voicechat/shared'

/** У ядра. */
export const INTERNAL_KANBAN_CORE_PATH = '/internal/kanban/core'
export const INTERNAL_KANBAN_EXEC_STREAM_PATH = '/internal/kanban/exec-stream'
export const INTERNAL_KANBAN_EVENTS_PATH = '/internal/kanban/events'
/** У канбана. */
export const KANBAN_INTERNAL_SERVICE_PATH = '/internal/service'
export const KANBAN_INTERNAL_MACHINES_PATH = '/internal/machines'
export const KANBAN_HEALTH_PATH = '/v1/health'

/** События кластера, которые ядро воспроизводит на своих лентах `KanbanService`. */
export type KanbanEvent =
  | { kind: 'frame'; message: ServerMessage; userId: string }
  | { kind: 'board'; projectId: string }
  | { kind: 'preparationRun'; update: { userId: string; projectId: string; taskId: string; runId: string } }
  | { kind: 'taskRepositories'; update: { projectId: string; taskId: string } }
  | { kind: 'qaStage'; update: { projectId: string; taskId: string; stage: QaRunStage } }
  | { kind: 'improvements'; projectId: string }
  | { kind: 'notification'; event: { projectId: string; userId?: string; kind?: 'membership' } }
export interface KanbanEventsRequest { events: KanbanEvent[] }

/** Снимок одной онлайн-машины для зеркала канбана. */
export interface MachineSnapshot {
  id: string
  name?: string
  platform?: string
  policy?: AgentPolicy
  telemetry?: AgentTelemetry
}
export interface MachinesSnapshotRequest { machines: MachineSnapshot[] }

/** Потоковый exec — общий формат `internal/execStream.ts`. */
export type { ExecStreamLine, ExecStreamRequest } from '../internal/execStream.js'

/** Методы `KanbanService`, которые ядро зовёт у процесса канбана. */
export const KANBAN_SERVICE_RPC_METHODS = ['snapshot', 'boardChanged', 'authorizeTunnel', 'tunnelClosed', 'previews'] as const
export type KanbanServiceRpcMethod = (typeof KANBAN_SERVICE_RPC_METHODS)[number]

/** Методы `KanbanCore`, доступные канбану по RPC у ядра. `exec`/`execStream` — отдельным потоковым эндпоинтом. */
export const KANBAN_CORE_RPC_METHODS = [
  'machines.snapshot', 'machines.fsRead', 'machines.fsWrite', 'machines.fsMkdir', 'machines.fsDelete', 'machines.fsRename',
  'machines.gitAccess', 'machines.createTunnel', 'machines.closeTunnel', 'machines.closeTunnelsForTarget',
  'kb.status', 'kb.topics', 'kb.document', 'kb.search', 'kb.context',
  'uploads.get', 'uploads.read', 'widgets.surface', 'widgets.updateSurface', 'widgets.uiRequest', 'ensureProjectMainCurrent'
] as const
export type KanbanCoreRpcMethod = (typeof KANBAN_CORE_RPC_METHODS)[number]
