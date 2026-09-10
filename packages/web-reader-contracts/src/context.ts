import type { ProjectTestUser } from '@voicechat/shared'
import type { PreviewToolEntry } from './turnToken.js'
/** Feature-preview окружение проекта в форме, пригодной для open Reader-ом. */
export interface PreviewEnvironmentInfo {
  taskId: string
  branch: string
  state: string
  healthy: boolean
  /** Адрес приложения окружения уже в форме http://<agentId>.machine.internal:<port>/. */
  appUrl: string | null
  storybookUrl: string | null
}

export interface PreviewTurnContext {
  /** agentId машины разговора или null (нет машины / нет доступа). */
  machineOf(entry: PreviewToolEntry): Promise<string | null>
  /** Тестовые пользователи проекта разговора (пусто — не заведены). */
  testUsersOf(entry: PreviewToolEntry): Promise<ProjectTestUser[]>
  /** Активные feature-preview окружения проекта разговора. */
  environmentsOf?(entry: PreviewToolEntry): Promise<PreviewEnvironmentInfo[]>
  /** Сброс cookie-контейнера превью пользователя (host сужает до одного сайта). */
  clearCookies?(entry: PreviewToolEntry, host?: string): number
  /** Проектная/ролевая политика evaluate; audit вызывается для любого вердикта. */
  gateEvaluate?(entry: PreviewToolEntry, code: string, confirmed: boolean): Promise<{ allowed: boolean; needsConfirmation?: boolean; reason?: string }>
}
