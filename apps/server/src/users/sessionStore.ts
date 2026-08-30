// Адаптер хранилища сессий: порт @voicechat/sessions-core поверх SQLite этого
// приложения. Своих запросов почти не пишет — переиспользует методы VoiceChatDb,
// которые уже знают про экономию записей и отзыв.
//
// Смысл адаптера не в коде, а в проверке: тот же контрактный набор, что гоняется
// на реализации в памяти, гоняется и здесь (sessionStore.test.ts). Пока он
// зелёный, серверное хранилище и переносимое ядро ведут себя одинаково.
import type { DeviceSession, NewSession, SessionPatch, SessionStore } from '@voicechat/sessions-core'
import type { VoiceChatDb } from '../db/database.js'

export function createDbSessionStore(db: VoiceChatDb, now: () => number = Date.now): SessionStore {
  return {
    create(input: NewSession): void {
      db.createSession(input.sid, input.user, {
        ip: input.ip,
        userAgent: input.userAgent,
        ttlMs: input.ttlMs,
        deviceKey: input.deviceKey ?? null,
        platform: input.platform ?? null,
        clientVersion: input.clientVersion ?? null,
        geo: input.geo ?? null,
        at: now()
      })
    },
    get(sid: string): DeviceSession | null {
      const session = db.getSession(sid)
      // Контракт ядра требует, чтобы истёкшая сессия читалась как отсутствующая;
      // в БД срок проверяет вызывающий, поэтому фильтруем здесь.
      return session && session.expiresAt > now() ? session : null
    },
    has: (sid) => db.hasSessionRow(sid),
    list: (user) => db.listSessions(user, now()),
    touch(sid, input) {
      db.touchSession(sid, input.ttlMs, input.path, now())
    },
    update: (sid, patch: SessionPatch) => db.updateSession(sid, patch, now()),
    revoke: (sid) => db.revokeSessionById(sid, now()),
    revokeAll: (user, exceptSid) => db.revokeUserSessions(user, exceptSid ?? null, now()),
    prune: (options) => db.pruneSessions(options?.keepRevokedMs, now())
  }
}
