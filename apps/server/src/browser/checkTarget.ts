// Куда уходит действие модели: изолированный Chromium или живая панель.
//
// Раньше выбор был один — разговор Playwright Reader. Теперь тот же Chromium
// обслуживает браузерные проверки стадии разработки: у задачи включён режим
// `chromium`, и её ход получает не relay в браузер пользователя (где страницы
// рана нет), а серверный браузер.
//
// Сессия проверки живёт по задаче, а не по разговору и не по рану: у задачи
// несколько ранов и чат карточки, а профиль Chromium — файловый каталог в томе.
// Ключ по рану оставлял бы в томе по каталогу на каждый прогон.

import type { CiBrowserCheck } from '@voicechat/shared'
import { isMachinePreviewUrl, machinePreviewUrl } from './machinePreview.js'
import type { PreviewAction } from '@voicechat/shared'

export interface BrowserCheckTarget {
  /** Идентификатор сессии раннера. */
  sessionId: string
  /** Ключ профиля Chromium (второй ключ пары в `profilePath`). */
  conversationKey: string
}

export interface BrowserCheckInput {
  conversationId: string
  taskId: string | null | undefined
  playwrightReader: boolean
  check: CiBrowserCheck
}

/** `null` — этот разговор не про изолированный браузер, идём прежним путём. */
export function browserCheckTarget(input: BrowserCheckInput): BrowserCheckTarget | null {
  if (input.playwrightReader) return { sessionId: input.conversationId, conversationKey: input.conversationId }
  if (input.taskId && input.check.mode === 'chromium') {
    const key = `task-${input.taskId}`
    return { sessionId: key, conversationKey: key }
  }
  return null
}

/**
 * Адрес машины в действии `open` подменяется адресом прокси превью: dev-сервер
 * стоит на loopback машины, а Chromium ходит из своего контейнера. Остальные
 * действия и публичные адреса остаются как есть.
 */
export function withMachinePreviewTarget(action: PreviewAction, runnerFacingBase: string): PreviewAction {
  if (action.kind !== 'open' || !isMachinePreviewUrl(action.url)) return action
  return { ...action, url: machinePreviewUrl(runnerFacingBase, action.url) }
}
