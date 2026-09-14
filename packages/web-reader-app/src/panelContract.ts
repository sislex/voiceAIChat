import type { PreviewElementPayload } from '@shared/previewInspector'
import type { PreviewAction } from '@shared/previewActions'
import type { WebRecorderAreaScreenshot } from '@shared/webRecorder'
import type { ReaderHostRegistration } from './hostBridge'


// Host-адаптер самостоятельного iframe-приложения Web Reader. Владеет только
// транспортом: iframe /web-recorder/, проверка event.origin/event.source,
// cookie-гейт ensurePreview. Вся логика lifecycle — в createReaderHostBridge;
// чат, LLM и сохранение previewUrl остаются у вызывающего host. Платформа
// (origin и подписка на message) инъецируется — пакет не трогает window сам.

export interface WebReaderFramePlatform {
  /** Origin приложения: им проверяется event.origin и подписывается postMessage. */
  origin: string
  subscribeMessages: (listener: (event: MessageEvent) => void) => () => void
}


export interface WebReaderFrameProps {
  conversationId: string
  conversationUrl: string | null
  projectUrl: string | null
  platform: WebReaderFramePlatform
  /** Выпуск preview-cookie по Bearer-токену (web); в desktop моста нет — гейт открыт. */
  ensurePreview?: (() => Promise<boolean>) | undefined
  onSave: (url: string | null) => Promise<void>
  onSelectElement?: ((element: PreviewElementPayload) => void) | undefined
  /** Снимок области страницы, выделенной пользователем («📸 Область»). */
  onAreaScreenshot?: ((shot: WebRecorderAreaScreenshot) => void) | undefined
  /** Актуальная регистрация iframe (или null): host сверяет по ней MCP-команды. */
  onRegisterHost?: ((registration: ReaderHostRegistration | null) => void) | undefined
  /** Последние подтверждённые действия модели; кнопка повторяет их через тот же host. at — время события. */
  actions?: readonly { id: string; action: PreviewAction; address: string | null; title: string | null; at?: number; summary?: string; ok?: boolean }[]
  /** Заголовок открытой страницы (null — страницы нет): для подписи мобильной вкладки. */
  onPageTitle?: ((title: string | null) => void) | undefined
  /** Пользователь выделил текст на странице и хочет спросить о нём в чате. */
  onAsk?: ((text: string) => void) | undefined
  /** Пользователь взял управление («Только я управляю») или вернул его. */
  onControl?: ((manual: boolean) => void) | undefined
  /** Пользователь управляет сам: повтор и показ шагов ленты недоступны. */
  manual?: boolean
  /** Последнее неудавшееся действие модели: панель показывает причину и даёт повторить. */
  actionError?: { action: PreviewAction; error: string } | null
  onRetryAction?: ((action: PreviewAction) => void) | undefined
  onRepeatAction?: (action: PreviewAction) => void
  /** Очистить ленту действий ассистента. */
  onClearActions?: (() => void) | undefined
  /** Сколько ошибок страницы накоплено, кроме показанной первой. */
  pageErrorCount?: number
  /** Показать на странице элемент прошлого действия (прокрутить к селектору и подсветить). */
  onRevealAction?: (selector: string) => void
  pageError?: string | null
  onAskError?: (error: string) => void
  /** Действие модели, которое сейчас выполняется в панели: человек видит, что ассистент делает. */
  pendingAction?: PreviewAction | null
  /** Адрес standalone-сборки Reader; production и dev-proxy раздают /web-recorder/. */
  src?: string
}
