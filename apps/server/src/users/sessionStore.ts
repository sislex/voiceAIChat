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
    async create(input: NewSession): Promise<void> {
      await db.identity.createSession(input.sid, input.user, {
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
    async get(sid: string): Promise<DeviceSession | null> {
      const session = await db.identity.getSession(sid)
      // Контракт ядра требует, чтобы истёкшая сессия читалась как отсутствующая;
      // в БД срок проверяет вызывающий, поэтому фильтруем здесь.
      return session && session.expiresAt > now() ? session : null
    },
    has: async (sid) => await db.identity.hasSessionRow(sid),
    list: async (user) => await db.identity.listSessions(user, now()),
    async touch(sid, input) {
      await db.identity.touchSession(sid, input.ttlMs, input.path, now())
    },
    update: async (sid, patch: SessionPatch) => await db.identity.updateSession(sid, patch, now()),
    revoke: async (sid) => await db.identity.revokeSessionById(sid, now()),
    revokeAll: async (user, exceptSid) => await db.identity.revokeUserSessions(user, exceptSid ?? null, now()),
    prune: async (options) => await db.identity.pruneSessions(options?.keepRevokedMs, now())
  }
}
