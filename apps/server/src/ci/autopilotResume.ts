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
