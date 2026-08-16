// Токены сессии приложения. Пользователи теперь живут в БД (таблица users) —
// здесь только stateless HMAC-токен (payload = имя) и секрет на диске. Роль и
// признак блокировки резолвятся из БД при каждой проверке (см. auth.ts).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionUser } from '@voicechat/shared'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest())
}

/** Подписанный токен `payloadB64.sigB64` для пользователя (в payload — только имя). */
export function signToken(user: SessionUser, secret: string): string {
  // Случайный id делает каждую сессию отдельной: logout может отозвать текущий
  // токен, не завершая другие входы пользователя и не блокируя следующий login.
  const payload = base64url(Buffer.from(JSON.stringify({ name: user.name, sid: base64url(randomBytes(18)) })))
  return `${payload}.${sign(payload, secret)}`
}

/** Проверка подписи токена → имя пользователя (без роли; роль берётся из БД). */
export function verifyTokenName(token: string | undefined, secret: string): string | null {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payload, secret)
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as { name?: unknown }
    return typeof parsed.name === 'string' ? parsed.name : null
  } catch {
    return null
  }
}

/** Читает секрет подписи токенов из dataDir или создаёт новый (переживает рестарт). */
export function loadOrCreateSecret(dataDir: string): string {
  const file = join(dataDir, 'session.secret')
  if (existsSync(file)) {
    const s = readFileSync(file, 'utf8').trim()
    if (s) return s
  }
  const secret = randomBytes(32).toString('hex')
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
}
