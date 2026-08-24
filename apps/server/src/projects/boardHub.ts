// Процесс-глобальный эмиттер изменений досок проектов. REST-мутации зовут
// emit(projectId); WS-сессии подписчиков перечитывают доску и шлют board.update.
// Не хранит состояние — только уведомляет (истина живёт в БД). Аналог
// AgentRegistry.onChange для живого списка машин.

export type BoardListener = (projectId: string) => void
export interface PreparationRunUpdate { userId: string; projectId: string; taskId: string; runId: string }
export type PreparationRunListener = (update: PreparationRunUpdate) => void

export class BoardHub {
  private readonly listeners = new Set<BoardListener>()
  private readonly preparationRunListeners = new Set<PreparationRunListener>()

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

  /** Лёгкая адресная инвалидация REST-снимка истории preparation-run. */
  emitPreparationRun(update: PreparationRunUpdate): void {
    for (const listener of this.preparationRunListeners) listener(update)
  }

  onPreparationRunChange(cb: PreparationRunListener): () => void {
    this.preparationRunListeners.add(cb)
    return () => this.preparationRunListeners.delete(cb)
  }
}
