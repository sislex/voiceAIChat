// Правило: когда автопроход возобновляет упавший ран, а когда заводит новый.
// Вынесено из `server.ts` отдельной функцией, потому что это решение о судьбе
// уже сделанной работы модели — его нужно видеть в тестах целиком, без реестра
// машин, воркспейсов и живого CI.

export interface AutopilotResumeInput {
  /** Статус последнего рана задачи; null — ранов ещё не было. */
  status: string | null
  /** Сколько раз ран падал по вине машины/окружения (события `run.infra_error`). */
  infraErrors: number
  /** Сколько раз автопроход уже возобновлял этот ран. */
  resumes: number
  /** Предел возобновлений одного рана. */
  limit: number
}

/**
 * Возобновляем только терминально упавший ран и только когда падение было
 * инфраструктурным: работа модели уже лежит в рабочей копии, и новый ран
 * заставил бы её повторить. Дефект кода лечится обычным fix-loop, а не
 * повтором того же шага, поэтому без `run.infra_error` возобновления нет.
 * Лимит обязателен: сломанное окружение иначе крутило бы ран по кругу.
 */
export function shouldResumeAfterInfraFailure(input: AutopilotResumeInput): boolean {
  if (input.status !== 'failed' && input.status !== 'timeout') return false
  if (input.infraErrors <= 0) return false
  return input.resumes < input.limit
}

/** Пауза между автоматическими перезапусками development-рана. */
export const AUTOPILOT_RETRY_BACKOFF_MS = 120_000

/**
 * Грязная рабочая копия задачи — не повод жечь попытки: ран падает мгновенно, и
 * три автоматических перезапуска сгорают за секунды (реальный случай CHAT-413 —
 * работа модели осталась незакоммиченной после сна ноутбука). Решение здесь
 * человеческое: сохранить работу повтором с шага коммита или сбросить копию.
 */
const DIRTY_WORKSPACE = /Рабочая копия содержит локальные изменения/i

export function isDirtyWorkspaceFailure(error: string | null | undefined): boolean {
  return Boolean(error && DIRTY_WORKSPACE.test(error))
}

export interface AutopilotRetryInput {
  /** Когда завершился последний ран задачи; null — время неизвестно. */
  finishedAt: number | null
  now: number
  backoffMs?: number
}

/**
 * Перезапуск не раньше, чем через паузу после предыдущего провала. Без неё
 * board-события гнали ретраи подряд, и лимит доработок исчерпывался за 14 секунд
 * — вместо трёх осмысленных попыток задача получала три мгновенных отказа.
 */
export function retryAllowedNow(input: AutopilotRetryInput): boolean {
  if (input.finishedAt == null) return true
  const backoff = input.backoffMs ?? AUTOPILOT_RETRY_BACKOFF_MS
  return input.now - input.finishedAt >= backoff
}
