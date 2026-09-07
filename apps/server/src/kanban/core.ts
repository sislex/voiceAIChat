// Порт `KanbanCore` — всё, что канбан-кластер берёт у процесса ядра (docs/plans/kanban-service.md,
// круг 2). Это только состояние процесса: живые WebSocket машин, файловый индекс базы знаний,
// вложения на диске ядра, git-копии проектов и снимок «что открыто» у виджета. Доменные данные
// (чат, пользователи, машины в БД) кластер читает сам через `VoiceChatDb` — отдельный сервис
// канбана работает на той же базе (Postgres), и дублировать репозитории RPC незачем.
//
// Локальная реализация — `kanbanBridge/localCore.ts` (ядро отдаёт свои объекты как есть);
// в отдельном процессе тот же контракт реализует HTTP-клиент к `/internal/*` ядра.
import type { AgentPolicy, AgentTelemetry, FsResult, GitAccessRequest, GitAccessResult, WidgetSurfaceSnapshot } from '@voicechat/shared'
import type { ExecMeta, ExecResult } from '../agents/registry.js'
import type { KnowledgeBaseService } from '../kb/types.js'
import type { StoredUpload } from '../uploads.js'
import type { WidgetUiRelay } from '../mcp/widgetUiRelay.js'

/**
 * Узкий фасад реестра машин: ровно те методы, которыми пользуется кластер (замер по коду —
 * `isOnline` 21, `policyOf` 5, `fsRead` 6, `gitAccess` 5, …). `AgentRegistry` удовлетворяет ему структурно
 * (проверка типом в `boundary.test.ts`); PTY, тоннели чата, `onChange` и прочее ядро не отдаёт.
 */
export interface KanbanMachines {
  isOnline(agentId: string): boolean
  nameOf(agentId: string): string | undefined
  platformOf(agentId: string): string | undefined
  policyOf(agentId: string): AgentPolicy | undefined
  telemetryOf(agentId: string): AgentTelemetry | undefined
  exec(agentId: string, command: string, timeoutMs: number, signal?: AbortSignal, meta?: ExecMeta): Promise<ExecResult>
  execStream(agentId: string, command: string, timeoutMs: number, onChunk: (data: string) => void, signal?: AbortSignal): Promise<ExecResult>
  fsRead(agentId: string, path: string): Promise<FsResult>
  fsWrite(agentId: string, path: string, dataBase64: string): Promise<FsResult>
  fsMkdir(agentId: string, path: string): Promise<FsResult>
  fsDelete(agentId: string, path: string): Promise<FsResult>
  fsRename(agentId: string, from: string, to: string): Promise<FsResult>
  /** Доступ машины к git-репозиторию проекта: статус, настройка токена, проверка. */
  gitAccess(agentId: string, request: GitAccessRequest): Promise<GitAccessResult>
  createTunnel(id: string, sourceAgentId: string, targetAgentId: string, targetPort: number, authorize?: () => Promise<boolean>, onClose?: () => Promise<void>): Promise<number>
  closeTunnel(id: string): boolean
  closeTunnelsForTarget(agentId: string): void
}

/** Вложения чата лежат на диске ядра; кластеру нужно только найти файл по id. */
export interface KanbanUploads {
  get(id: string): StoredUpload | undefined
}

/** Снимок экрана виджета для mcp__kanban__*: кладёт `turns.ts`/WS ядра, читает MCP канбана. */
export interface KanbanWidgets {
  contexts: {
    surface(conversationId: string): WidgetSurfaceSnapshot | null
    updateSurface(conversationId: string, surface: WidgetSurfaceSnapshot): void
  }
  ui: Pick<WidgetUiRelay, 'request'>
}

/** Актуализация main проекта в git-копии машины; живёт в ядре рядом с панелью кода. */
export type EnsureProjectMainCurrent = (args: { userId: string; projectId: string; conversationId: string | null; agentId: string; path: string; branch: string; gitUrl: string }) => Promise<{ baseSha: string; autoHealed?: unknown }>

export interface KanbanCore {
  machines: KanbanMachines
  kb: KnowledgeBaseService
  uploads: KanbanUploads
  widgets: KanbanWidgets
  ensureProjectMainCurrent: EnsureProjectMainCurrent
}
