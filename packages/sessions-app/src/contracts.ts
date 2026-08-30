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
}
