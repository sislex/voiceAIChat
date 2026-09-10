import type { BrowserProfileMode, Conversation } from '@voicechat/shared'

export interface BrowserModelTarget {
  profileMode?: BrowserProfileMode
  sessionId: string
  conversationKey: string
}

/** Данные и эффекты ядра: приложение не открывает БД и не хранит пользовательские сессии. */
export interface PlaywrightReaderCore {
  /** Только разговор, доступный этому пользователю; чужой и отсутствующий — null. */
  conversation(userId: string, conversationId: string): Promise<Pick<Conversation, 'assistantKind'> | null>
  /** Chromium разговора Reader или проверки задачи; null — обычная панель Web Reader. */
  modelTarget(userId: string, conversationId: string): Promise<BrowserModelTarget | null>
  issuePreviewRunKey(userId: string): string | Promise<string>
  logBrowserShot(userId: string, conversationId: string, pngBase64: string): Promise<void>
}
