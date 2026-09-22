// Public login status DTOs and Core account-role descriptions. CLI credential parsing belongs to LLM Runner.

import type { LlmProvider, UserRole } from './types'

/** Account roles do not replace project membership or individual model restrictions. */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Администратор: управление пользователями, доступом и тарифами.',
  developer: 'Разработчик: рабочая учётная запись без управления пользователями и тарифами.',
  tester: 'Тестировщик: рабочая учётная запись без управления пользователями и тарифами.',
  observer: 'Наблюдатель: без управления пользователями и тарифами. Доступ к проектам задаётся отдельно.'
}

/** Статус входа одного CLI-движка. */
export interface CliLoginStatus {
  provider: LlmProvider
  /** Найдена ли валидная авторизация. */
  loggedIn: boolean
  /** Короткое пояснение для UI: тип подписки / режим входа / что сделать. */
  detail?: string
}

/** Статусы входа обоих движков. */
export interface LoginStatusMap {
  claude: CliLoginStatus
  codex: CliLoginStatus
}
