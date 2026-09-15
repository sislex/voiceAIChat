// Cycle grouping and status vocabulary for the new task card ("Проект 19").
//
// The Make design draws every process tab (preparation, development, QA passes,
// merge) as a rail of stages: stage 1 is the original statement, every later
// stage is one submitted rework cycle. Runs are not linked to cycles on the
// server, so the card attributes them by time: a run belongs to the latest
// cycle submitted before it started. Preparation runs additionally carry the
// cycle's `preparationRunId`, which pins them regardless of timestamps.
import type { BadgeTone } from '@voicechat/ui-kit'
import type { CiStatus } from '@shared/ci'
import type { MergeRunStatus } from '@shared/merge'
import type { ComponentQaRunStatus, IntegrationTestRunStatus, QaSessionStatus, QaStageRunStatus, TaskPreparationStatus } from '@shared/qa'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'

/**
 * Status vocabulary of the design: one badge palette for every stage kind.
 * `skipped` is not in the Make mock but exists in CI; showing it as "cancelled"
 * would blame the user for a decision the server made.
 */
export type StageStatus =
  | 'idle' | 'loading' | 'queued' | 'running' | 'waiting_for_answer' | 'validating'
  | 'paused' | 'blocked' | 'failed' | 'timeout' | 'cancelled' | 'success' | 'skipped'

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  idle: 'Не запускался',
  loading: 'Загрузка',
  queued: 'В очереди',
  running: 'Выполняется',
  waiting_for_answer: 'Ожидает ответа',
  validating: 'Валидация',
  paused: 'Ожидает решения',
  blocked: 'Заблокирован',
  failed: 'Ошибка',
  timeout: 'Таймаут',
  cancelled: 'Отменён',
  success: 'Успешно',
  skipped: 'Пропущен'
}

/** Badge tone of the shared ui-kit pill for a stage status. */
export function stageStatusTone(status: StageStatus): BadgeTone {
  switch (status) {
    case 'loading': case 'queued': case 'running': case 'validating': return 'running'
    case 'waiting_for_answer': case 'paused': case 'cancelled': return 'warning'
    case 'blocked': case 'timeout': case 'failed': return 'danger'
    case 'success': return 'success'
    default: return 'neutral'
  }
}

/** A stage still doing work: the rail keeps its details expanded. */
export function isLiveStageStatus(status: StageStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting_for_answer' || status === 'validating' || status === 'loading'
}

/** Attention states open the stage by default too — the user needs to act. */
export function isOpenByDefault(status: StageStatus): boolean {
  return isLiveStageStatus(status) || status === 'failed' || status === 'timeout' || status === 'blocked' || status === 'paused'
}

export function preparationStageStatus(status: TaskPreparationStatus): StageStatus {
  if (status === 'completed' || status === 'success') return 'success'
  return status
}

export function ciStageStatus(status: CiStatus): StageStatus {
  switch (status) {
    case 'awaiting_input': return 'waiting_for_answer'
    case 'interrupted': return 'failed'
    default: return status
  }
}

export function qaRunStageStatus(status: ComponentQaRunStatus | IntegrationTestRunStatus): StageStatus {
  switch (status) {
    case 'passed': return 'success'
    // A stale run needs a decision (rerun or accept) rather than being an error.
    case 'stale': return 'paused'
    default: return status
  }
}

export function qaStageRunStatus(status: QaStageRunStatus): StageStatus {
  switch (status) {
    case 'awaiting_input': return 'waiting_for_answer'
    case 'gate_failed': return 'blocked'
    case 'interrupted': return 'failed'
    default: return status
  }
}

export function mergeStageStatus(status: MergeRunStatus): StageStatus {
  switch (status) {
    case 'success': case 'failed': case 'cancelled': case 'queued': case 'timeout': return status
    case 'decision_required': return 'paused'
    default: return 'running'
  }
}

export function qaSessionStageStatus(status: QaSessionStatus): StageStatus {
  switch (status) {
    case 'active': return 'running'
    case 'passed': return 'success'
    case 'stale': return 'paused'
    default: return status
  }
}

export interface CycleStage<T> {
  /** Stable key for React lists: `base` or the cycle id. */
  key: string
  /** 1-based number in the rail; the design numbers stages, not cycles. */
  number: number
  /** null — the original statement of the task. */
  cycle: TaskReworkCycleViewModel | null
  /** Items (runs, sessions) attributed to this stage, oldest first. */
  items: T[]
}

export interface AssignOptions<T> {
  createdAt: (item: T) => number
  /** Hard link from an item to a cycle id (e.g. `preparationRunId`), wins over time. */
  pinnedCycleId?: (item: T, cycles: TaskReworkCycleViewModel[]) => string | null
}

/**
 * Distributes runs between the base stage and submitted cycles by start time.
 * Every cycle gets a stage even without runs — the rail must show that the
 * cycle is waiting for its pass, exactly like the Make mock does.
 */
export function assignToCycles<T>(cycles: readonly TaskReworkCycleViewModel[], items: readonly T[], options: AssignOptions<T>): CycleStage<T>[] {
  const ordered = [...cycles].filter((cycle) => cycle.status !== 'draft').sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence)
  const stages: CycleStage<T>[] = [{ key: 'base', number: 1, cycle: null, items: [] }]
  for (const cycle of ordered) stages.push({ key: cycle.id, number: stages.length + 1, cycle, items: [] })
  const sorted = [...items].sort((a, b) => options.createdAt(a) - options.createdAt(b))
  for (const item of sorted) {
    const pinned = options.pinnedCycleId?.(item, ordered) ?? null
    const pinnedStage = pinned ? stages.find((stage) => stage.cycle?.id === pinned) : undefined
    if (pinnedStage) { pinnedStage.items.push(item); continue }
    const at = options.createdAt(item)
    let target = stages[0]!
    for (const stage of stages) if (stage.cycle && stage.cycle.createdAt <= at) target = stage
    target.items.push(item)
  }
  return stages
}

/** Status of a stage: the newest item decides; no items — the stage waits. */
export function stageStatusOf<T>(stage: CycleStage<T>, statusOf: (item: T) => StageStatus): StageStatus {
  const latest = stage.items[stage.items.length - 1]
  return latest ? statusOf(latest) : 'idle'
}

/** Cycle-aware stage title: "… · доработки 2, 4" or "… · первоначальная постановка". */
export function stageTitle(name: string, stage: CycleStage<unknown>): string {
  return stage.cycle ? `${name} · доработка ${stage.cycle.sequence}` : `${name} · первоначальная постановка`
}

/** Human-readable count with the Russian plural of the noun. */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${few}`
  return `${count} ${many}`
}
