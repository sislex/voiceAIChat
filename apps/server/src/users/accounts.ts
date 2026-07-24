// Учётные записи приложения (многопользовательский режим web-версии).
// Пользователи захардкожены: admin и user, пароль — пустая строка. Сессия —
// stateless HMAC-токен (секрет на диске в dataDir), server-side хранилища нет.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionUser, UserRole } from '@voicechat/shared'

interface Account {
  name: string
  role: UserRole
  password: string
}

/** Захардкоженные пользователи (оба с пустым паролем). */
const USERS: Account[] = [
  { name: 'admin', role: 'admin', password: '' },
  { name: 'user', role: 'user', password: '' }
]

/** Проверка логина/пароля → пользователь сессии или null. */
export function verifyCredentials(name: string, password: string): SessionUser | null {
  const acc = USERS.find((u) => u.name === name)
  if (!acc || acc.password !== password) return null
  return { name: acc.name, role: acc.role }
}

/** Роль пользователя по имени (null — нет такого). */
export function roleOf(name: string): UserRole | null {
  return USERS.find((u) => u.name === name)?.role ?? null
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest())
}

/** Подписанный токен `payloadB64.sigB64` для пользователя. */
export function signToken(user: SessionUser, secret: string): string {
  const payload = base64url(Buffer.from(JSON.stringify({ name: user.name, role: user.role })))
  return `${payload}.${sign(payload, secret)}`
}

/** Проверка токена: HMAC + сверка с актуальной учёткой. null — невалиден. */
export function verifyToken(token: string | undefined, secret: string): SessionUser | null {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payload, secret)
  // Постоянное по времени сравнение (длины должны совпасть — иначе сразу null).
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  let parsed: { name?: unknown; role?: unknown }
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch {
    return null
  }
  if (typeof parsed.name !== 'string') return null
  // Роль берём из актуальной учётки (не доверяем содержимому токена).
  const role = roleOf(parsed.name)
  if (!role) return null
  return { name: parsed.name, role }
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
