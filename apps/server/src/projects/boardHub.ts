// Процесс-глобальный эмиттер изменений досок проектов. REST-мутации зовут
// emit(projectId); WS-сессии подписчиков шлют лёгкую инвалидацию board.changed.
// Не хранит состояние — только уведомляет (истина живёт в БД). Аналог
// AgentRegistry.onChange для живого списка машин.

export type BoardListener = (projectId: string) => void
export interface PreparationRunUpdate { userId: string; projectId: string; taskId: string; runId: string }
export type PreparationRunListener = (update: PreparationRunUpdate) => void
export interface TaskRepositoriesUpdate { projectId: string; taskId: string }
export type TaskRepositoriesListener = (update: TaskRepositoriesUpdate) => void
/** Изменилось состояние QA-этапа задачи: панель перечитает снимок сама. */
export interface QaStageUpdate { projectId: string; taskId: string; stage: import('@voicechat/shared').QaRunStage }
export type QaStageListener = (update: QaStageUpdate) => void

export interface NotificationInvalidation {
  projectId: string
  userId?: string
  /**
   * Вид события. Хаб общий для уведомлений подготовки и для смены состава
   * участников, а WS-сессии шлют по ним разные кадры: без этого признака
   * отличить «пришло уведомление» от «сменилась роль» на стороне сессии нечем.
   */
  kind?: 'membership'
}

export class NotificationHub {
  private readonly listeners = new Set<(event: NotificationInvalidation) => void>()

  emit(projectId: string, userId?: string, kind?: NotificationInvalidation['kind']): void {
    for (const listener of this.listeners) listener({ projectId, ...(userId ? { userId } : {}), ...(kind ? { kind } : {}) })
  }

  onChange(listener: (event: NotificationInvalidation) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export class BoardHub {
  private readonly listeners = new Set<BoardListener>()
  private readonly preparationRunListeners = new Set<PreparationRunListener>()
  private readonly taskRepositoriesListeners = new Set<TaskRepositoriesListener>()
  private readonly qaStageListeners = new Set<QaStageListener>()

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

  /**
   * Адресная инвалидация QA-этапа. Отдельно от `emit(projectId)`: доска обновляется
   * на каждое изменение любой задачи, а панель этапа должна дёргать свой REST только
   * когда изменился именно её ран.
   */
  emitQaStage(update: QaStageUpdate): void {
    for (const listener of this.qaStageListeners) listener(update)
  }

  onQaStageChange(cb: QaStageListener): () => void {
    this.qaStageListeners.add(cb)
    return () => this.qaStageListeners.delete(cb)
  }

  emitTaskRepositories(update: TaskRepositoriesUpdate): void {
    for (const listener of this.taskRepositoriesListeners) listener(update)
  }

  onTaskRepositoriesChange(cb: TaskRepositoriesListener): () => void {
    this.taskRepositoriesListeners.add(cb)
    return () => this.taskRepositoriesListeners.delete(cb)
  }
}
