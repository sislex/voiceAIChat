import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  verifyCredentials,
  roleOf,
  signToken,
  verifyToken,
  loadOrCreateSecret
} from './accounts.js'

describe('accounts — учётные записи', () => {
  it('admin и user входят с пустым паролем, роли верные', () => {
    expect(verifyCredentials('admin', '')).toEqual({ name: 'admin', role: 'admin' })
    expect(verifyCredentials('user', '')).toEqual({ name: 'user', role: 'user' })
  })

  it('неверный пароль или неизвестный пользователь → null', () => {
    expect(verifyCredentials('admin', 'x')).toBeNull()
    expect(verifyCredentials('root', '')).toBeNull()
  })

  it('roleOf возвращает роль или null', () => {
    expect(roleOf('admin')).toBe('admin')
    expect(roleOf('user')).toBe('user')
    expect(roleOf('нет')).toBeNull()
  })
})

describe('accounts — токены', () => {
  const secret = 'secret-A'

  it('подписанный токен проходит проверку и даёт пользователя', () => {
    const token = signToken({ name: 'user', role: 'user' }, secret)
    expect(verifyToken(token, secret)).toEqual({ name: 'user', role: 'user' })
  })

  it('роль берётся из актуальной учётки, а не из тела токена', () => {
    // Подделать роль в токене нельзя: verifyToken перечитывает роль по имени.
    const token = signToken({ name: 'user', role: 'admin' }, secret)
    expect(verifyToken(token, secret)?.role).toBe('user')
  })

  it('чужой секрет / подделка / мусор → null', () => {
    const token = signToken({ name: 'admin', role: 'admin' }, secret)
    expect(verifyToken(token, 'secret-B')).toBeNull()
    expect(verifyToken(token + 'x', secret)).toBeNull()
    expect(verifyToken('garbage', secret)).toBeNull()
    expect(verifyToken(undefined, secret)).toBeNull()
  })
})

describe('accounts — секрет на диске', () => {
  it('создаёт секрет и переиспользует его при повторном чтении', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-secret-'))
    try {
      const s1 = loadOrCreateSecret(dir)
      expect(existsSync(join(dir, 'session.secret'))).toBe(true)
      expect(s1.length).toBeGreaterThan(0)
      // Повторно — тот же секрет (переживает «перезапуск»).
      expect(loadOrCreateSecret(dir)).toBe(s1)
      expect(readFileSync(join(dir, 'session.secret'), 'utf8')).toBe(s1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
