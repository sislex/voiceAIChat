// Процесс-глобальный эмиттер изменений досок проектов. REST-мутации зовут
// emit(projectId); WS-сессии подписчиков перечитывают доску и шлют board.update.
// Не хранит состояние — только уведомляет (истина живёт в БД). Аналог
// AgentRegistry.onChange для живого списка машин.

export type BoardListener = (projectId: string) => void

export class BoardHub {
  private readonly listeners = new Set<BoardListener>()

  /** Уведомить подписчиков об изменении доски проекта. */
  emit(projectId: string): void {
    for (const l of this.listeners) l(projectId)
  }

  /** Подписаться на изменения; возвращает функцию отписки. */
  onChange(cb: BoardListener): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }
}
