import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { signToken, verifyTokenName, loadOrCreateSecret } from './accounts.js'
import { hashPassword, verifyPassword } from './passwords.js'

describe('accounts — токены', () => {
  const secret = 'secret-A'

  it('подписанный токен проходит проверку и даёт имя пользователя', () => {
    const token = signToken({ name: 'bob', role: 'developer' }, secret)
    expect(verifyTokenName(token, secret)).toBe('bob')
  })

  it('чужой секрет / подделка / мусор → null', () => {
    const token = signToken({ name: 'admin', role: 'admin' }, secret)
    expect(verifyTokenName(token, 'secret-B')).toBeNull()
    expect(verifyTokenName(token + 'x', secret)).toBeNull()
    expect(verifyTokenName('garbage', secret)).toBeNull()
    expect(verifyTokenName(undefined, secret)).toBeNull()
  })

  it('секрет на диске создаётся и переиспользуется (переживает рестарт)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-secret-'))
    try {
      const s1 = loadOrCreateSecret(dir)
      expect(existsSync(join(dir, 'session.secret'))).toBe(true)
      expect(loadOrCreateSecret(dir)).toBe(s1)
      expect(readFileSync(join(dir, 'session.secret'), 'utf8')).toBe(s1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('passwords — scrypt', () => {
  it('верный пароль проходит, неверный — нет; пустой пароль допустим', () => {
    const h = hashPassword('s3cret')
    expect(verifyPassword('s3cret', h)).toBe(true)
    expect(verifyPassword('nope', h)).toBe(false)
    const empty = hashPassword('')
    expect(verifyPassword('', empty)).toBe(true)
    expect(verifyPassword('x', empty)).toBe(false)
  })
})
