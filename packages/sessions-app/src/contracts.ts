// Порты модуля: всё, чем «сессии и устройства» касаются внешнего мира. Пакет
// не знает ни про REST, ни про WS, ни про window — хост приносит реализацию.
// Необязательные методы клиента — это не небрежность, а режимы: админке нужны
// только чтение и отзыв, и она не должна выдумывать заглушки для остального.
import type { DeviceSession, SessionPolicy } from '@voicechat/sessions-core'

export interface SessionsClient {
  list(): Promise<DeviceSession[]>
  revoke(sid: string): Promise<void>
  /** Завершить все, кроме текущей. */
  revokeOthers?(): Promise<void>
  /** Завершить все, включая текущую: выход со всех устройств сразу. */
  revokeAll?(): Promise<void>
  /** Имя устройства от пользователя; null — вернуть автоматическую подпись. */
  rename?(sid: string, label: string | null): Promise<void>
  setTrusted?(sid: string, trusted: boolean): Promise<void>
  /** Недавно завершённые сессии: отозванные и истёкшие, пока их не убрали. */
  listEnded?(): Promise<DeviceSession[]>
  /** «Это не я»: погасить всё и потребовать смену пароля. */
  panic?(): Promise<void>
  /** События безопасности этого устройства — ответ на «что тут вообще было». */
  history?(sid: string): Promise<SessionHistoryEvent[]>
  /** Снять доверие со всех устройств разом. */
  untrustAll?(): Promise<void>
}

/** Строка истории устройства: тип события, когда и подробность. */
export interface SessionHistoryEvent {
  id: number
  at: number
  type: string
  details: string
}

/** События, приходящие живьём: список устарел или текущую сессию завершили. */
export type SessionsEvent =
  | { type: 'sessions.update' }
  | { type: 'session.revoked'; sid: string }

export interface SessionsRealtime {
  subscribe(listener: (event: SessionsEvent) => void): () => void
}

export interface SessionsHost {
  /** Sid текущей сессии, если хост его знает: иначе полагаемся на флаг `current` из клиента. */
  currentSid?: string | null
  /** Текущую сессию завершили на другом устройстве — хосту пора на экран входа. */
  onSignedOut?(): void
  /** Часы: тесты и Storybook замораживают время, чтобы «активна сейчас» не мигала. */
  now?(): number
  /** Свои сроки и лимиты, если приложение живёт по другой политике. */
  policy?: Partial<SessionPolicy>
  /**
   * Скопировать текст в буфер обмена. Буфер платформенный, поэтому это порт:
   * модуль лишь решает, что копировать.
   */
  copy?(text: string): Promise<void> | void
  /**
   * Экран снова показан пользователю (вкладка активна, окно в фокусе). Модуль
   * по этому сигналу перечитывает список: живые кадры доходят не всегда — сон
   * машины, обрыв WS, — а читают список именно в момент возврата к нему.
   * Реализует хост: сам модуль про document и window не знает.
   */
  onVisible?(cb: () => void): () => void
}
