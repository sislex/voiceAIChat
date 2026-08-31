// Контракт оркестрации канбан-ассистента: план работ, который он ведёт сам.
//
// Почему это отдельная сущность, а не «модель подождёт в ходе»: ожидание merge
// длится дольше любого ответа модели и обязано пережить закрытие вкладки и
// рестарт сервера. План хранится в БД, исполняется фоном, а ассистент только
// ставит его и рассказывает о прогрессе.

export type OrchestrationStatus = 'running' | 'done' | 'failed' | 'cancelled'
export type OrchestrationItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

/**
 * Шаги плана. `wait_merge` — не действие, а условие: он держит зависящие шаги,
 * пока ветка задачи не влита, и это единственный способ не начинать
 * пересекающуюся работу раньше времени.
 */
export type OrchestrationItemKind = 'create_task' | 'run_ci' | 'run_qa' | 'run_merge' | 'wait_merge' | 'run_preview'

export interface OrchestrationItem {
  id: string
  position: number
  kind: OrchestrationItemKind
  title: string
  /** Задача шага; у `create_task` появляется после создания карточки. */
  taskId: string | null
  /** Позиции шагов этого же плана, которые должны завершиться раньше. */
  dependsOn: number[]
  payload: Record<string, unknown>
  status: OrchestrationItemStatus
  /** Идентификатор запущенного рана (CI, QA, merge), если шаг его создал. */
  runId: string | null
  /** Сколько раз шаг уже перезапускался после падения. */
  attempts: number
  error: string | null
  startedAt: number | null
  finishedAt: number | null
}

export interface Orchestration {
  id: string
  projectId: string
  conversationId: string | null
  owner: string
  title: string
  status: OrchestrationStatus
  error: string | null
  createdAt: number
  updatedAt: number
  items: OrchestrationItem[]
}

export interface OrchestrationItemInput {
  kind: OrchestrationItemKind
  title: string
  taskId?: string | null
  dependsOn?: number[]
  payload?: Record<string, unknown>
}

/**
 * Сколько раз шаг разрешено перезапустить после падения. Ноль по умолчанию:
 * молчаливый автоповтор сломанной разработки жжёт машину и время, поэтому
 * повтор — осознанное решение автора плана.
 */
export function orchestrationItemMaxAttempts(item: Pick<OrchestrationItem, 'payload'>): number {
  const value = (item.payload as { retries?: unknown }).retries
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(3, Math.trunc(value))) : 0
}

/** Максимум одновременно идущих планов на проект: серия задач — не пулемёт. */
export const MAX_ACTIVE_ORCHESTRATIONS = 3

/** Шаг готов к запуску: сам ждёт и все его зависимости уже завершены успешно. */
export function orchestrationItemReady(item: OrchestrationItem, all: OrchestrationItem[]): boolean {
  if (item.status !== 'pending') return false
  return item.dependsOn.every((position) => all.find((candidate) => candidate.position === position)?.status === 'done')
}

/** Итоговый статус плана по его шагам; `running`, пока есть незавершённые. */
export function orchestrationStatusOf(items: OrchestrationItem[]): OrchestrationStatus {
  if (items.some((item) => item.status === 'failed')) return 'failed'
  if (items.some((item) => item.status === 'cancelled')) return 'cancelled'
  return items.every((item) => item.status === 'done') ? 'done' : 'running'
}

/** Есть ли у шага задача: своя или унаследованная по цепочке зависимостей. */
export function inheritsTask(index: number, items: OrchestrationItemInput[], seen = new Set<number>()): boolean {
  const item = items[index]
  if (!item) return false
  if (item.taskId) return true
  if (item.kind === 'create_task') return true
  if (seen.has(index)) return false
  seen.add(index)
  return (item.dependsOn ?? []).some((dependency) => inheritsTask(dependency, items, seen))
}

/**
 * Циклы в зависимостях останавливают план навсегда, поэтому план с циклом не
 * принимается вовсе. Ссылка вперёд разрешена: порядок шагов задаёт не позиция,
 * а граф зависимостей.
 */
export function orchestrationPlanError(items: OrchestrationItemInput[]): string | null {
  if (!items.length) return 'План пуст'
  for (const [index, item] of items.entries()) {
    for (const dependency of item.dependsOn ?? []) {
      if (dependency === index) return `Шаг ${index + 1} зависит сам от себя`
      if (dependency < 0 || dependency >= items.length) return `Шаг ${index + 1} зависит от несуществующего шага ${dependency}`
    }
    if (item.kind !== 'create_task' && !inheritsTask(index, items)) {
      // Задача может рождаться в этом же плане: тогда шаг ссылается на
      // create_task через dependsOn — напрямую или через другие шаги.
      return `Шагу ${index + 1} (${item.kind}) нужна задача: укажи taskId или зависимость от create_task`
    }
  }
  const visiting = new Set<number>()
  const done = new Set<number>()
  const walk = (index: number): boolean => {
    if (done.has(index)) return false
    if (visiting.has(index)) return true
    visiting.add(index)
    for (const dependency of items[index]?.dependsOn ?? []) if (walk(dependency)) return true
    visiting.delete(index)
    done.add(index)
    return false
  }
  for (let index = 0; index < items.length; index += 1) if (walk(index)) return 'В плане есть цикл зависимостей'
  return null
}
