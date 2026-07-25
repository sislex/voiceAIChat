// Хеширование паролей пользователей: scrypt со случайной солью (node:crypto).
// Формат хранения: `scrypt$<saltHex>$<hashHex>`. Пустой пароль допустим.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEYLEN = 32

/** Хеш пароля для хранения в БД. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/** Проверка пароля против сохранённого хеша (постоянное время). */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[1], 'hex')
  const expected = Buffer.from(parts[2], 'hex')
  let actual: Buffer
  try {
    actual = scryptSync(password, salt, expected.length)
  } catch {
    return false
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
