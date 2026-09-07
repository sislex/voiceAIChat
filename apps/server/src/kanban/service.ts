// Порт `KanbanService` — что ядро берёт у канбан-кластера (docs/plans/kanban-service.md, круг 2):
// ленты кадров ранов для WS-сессий, события доски и уведомлений подготовки, сигнал «доска
// изменилась» от соседей (Make правит карточки через свой порт). Сегодня реализацию отдаёт
// `createKanbanModule` в том же процессе; в режиме отдельного сервиса ядро получит те же ленты
// по SSE, как `MakeHub`.
import type { QaRunStage, ServerMessage } from '@voicechat/shared'

export interface KanbanRunFeed {
  /** Кадры ранов (`ci.*`, `qa.*`, …) с владельцем — сессия отдаёт их только своему пользователю. */
  subscribe(listener: (m: ServerMessage, ownerUserId: string) => void): () => void
  /** Снимок рана при подписке клиента `ci.subscribe`. */
  snapshot(userId: string, runId: string): Promise<void | ServerMessage>
}

export interface KanbanBoardFeed {
  /** Доску изменил кто-то вне кластера (Make, панель кода) — разослать подписчикам. */
  changed(projectId: string): void
  subscribe(cb: (projectId: string) => void): () => void
  subscribePreparationRuns(cb: (update: { userId: string; projectId: string; taskId: string; runId: string }) => void): () => void
  subscribeTaskRepositories(cb: (update: { projectId: string; taskId: string }) => Promise<void>): () => void
  subscribeQaStages(cb: (update: { projectId: string; taskId: string; stage: QaRunStage }) => Promise<void>): () => void
  subscribeImprovements(cb: (projectId: string) => void): () => void
}

export interface KanbanNotificationFeed {
  subscribe(cb: (event: { projectId: string; userId?: string; kind?: 'membership' }) => Promise<void>): () => void
}

export interface KanbanService {
  runs: KanbanRunFeed
  board: KanbanBoardFeed
  notifications: KanbanNotificationFeed
}
