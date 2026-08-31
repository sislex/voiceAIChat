// Тон статуса QA для примитивов ui-kit.
//
// Статусы рана и шага у QA свои (`passed`/`blocked`/`stale`), а лозенги и
// таблицы говорят семантическими тонами. Таблица одна на все QA-панели: до неё
// каждая писала свой тернарник, и «заблокирован» у одной был красным, у другой —
// серым.
import type { ComponentQaScenarioStatus, QaStageRunStatus, QaStepStatus } from '@shared/qa'
import type { StatusTone } from '@voicechat/ui-kit'

/** Статус рана этапа: Component QA и интеграционные тесты делят его набор. */
export type QaRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled' | 'stale' | 'skipped'

export function qaRunTone(status: QaRunStatus): StatusTone {
  switch (status) {
    case 'running':
      return 'running'
    case 'passed':
      return 'success'
    case 'failed':
    case 'blocked':
      return 'danger'
    case 'stale':
      return 'warning'
    default:
      return 'neutral'
  }
}

export function qaStepTone(status: QaStepStatus): StatusTone {
  switch (status) {
    case 'running':
      return 'running'
    case 'passed':
      return 'success'
    case 'failed':
    case 'blocked':
      return 'danger'
    default:
      return 'neutral'
  }
}

/**
 * Статус сценария Component QA — свой набор: у него есть `not_applicable`, но нет
 * `cancelled`. Подпись тоже своя: `QA_STEP_STATUS_LABELS` про него не знает.
 */
export const COMPONENT_QA_SCENARIO_LABEL: Record<ComponentQaScenarioStatus, string> = {
  pending: 'Ожидает',
  passed: 'Пройден',
  failed: 'Ошибка',
  blocked: 'Заблокирован',
  not_applicable: 'Не применим'
}

export function qaScenarioTone(status: ComponentQaScenarioStatus): StatusTone {
  switch (status) {
    case 'passed':
      return 'success'
    case 'failed':
    case 'blocked':
      return 'danger'
    default:
      return 'neutral'
  }
}

/** Статус общего рана этапа (`qa_stage_runs`): свой набор с `gate_failed`. */
export function stageRunTone(status: QaStageRunStatus): StatusTone {
  switch (status) {
    case 'running':
    case 'queued':
      return 'running'
    case 'awaiting_input':
      return 'warning'
    case 'success':
      return 'success'
    case 'gate_failed':
    case 'failed':
      return 'danger'
    default:
      return 'neutral'
  }
}
