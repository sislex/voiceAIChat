// Канбан не подключён (нет VC_KANBAN_URL): тесты ядра и локальный запуск без сервиса канбана.
// Лент от кластера нет, окружений превью нет; сигнал «доска изменилась» от соседей ядра
// (Make, панель кода) по-прежнему доходит до подписчиков процесса.
import type { KanbanService } from '../kanban/service.js'

export function createOfflineKanban(): KanbanService {
  const board = new Set<(projectId: string) => void>()
  const none = (): (() => void) => () => {}
  return {
    runs: { subscribe: none, snapshot: async () => undefined },
    board: {
      changed: (projectId) => { for (const cb of board) cb(projectId) },
      subscribe: (cb) => { board.add(cb); return () => { board.delete(cb) } },
      subscribePreparationRuns: none,
      subscribeTaskRepositories: none,
      subscribeQaStages: none,
      subscribeImprovements: none,
      subscribeReleases: none
    },
    notifications: { subscribe: none },
    previews: { list: async () => [] }
  }
}
