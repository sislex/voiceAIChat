import { describe, it, expect } from 'vitest'
import { claudeLoginStatus, codexLoginStatus } from './auth'

const NOW = 1_700_000_000_000

describe('claudeLoginStatus', () => {
  it('файл отсутствует → не залогинен', () => {
    const s = claudeLoginStatus(null, NOW)
    expect(s).toMatchObject({ provider: 'claude', loggedIn: false })
    expect(s.detail).toContain('claude login')
  })

  it('валидный OAuth → залогинен, показывает подписку', () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'tok',
        refreshTokenExpiresAt: NOW + 1_000_000,
        subscriptionType: 'team'
      }
    })
    const s = claudeLoginStatus(raw, NOW)
    expect(s.loggedIn).toBe(true)
    expect(s.detail).toContain('team')
  })

  it('refresh-токен истёк → не залогинен', () => {
    const raw = JSON.stringify({
      claudeAiOauth: { accessToken: 'tok', refreshTokenExpiresAt: NOW - 1 }
    })
    expect(claudeLoginStatus(raw, NOW).loggedIn).toBe(false)
  })

  it('ANTHROPIC_API_KEY → залогинен без файла', () => {
    const s = claudeLoginStatus(null, NOW, true)
    expect(s.loggedIn).toBe(true)
    expect(s.detail).toContain('API-ключ')
  })

  it('битый JSON не роняет проверку', () => {
    expect(claudeLoginStatus('{не json', NOW).loggedIn).toBe(false)
  })
})

describe('codexLoginStatus', () => {
  it('файл отсутствует → не залогинен', () => {
    const s = codexLoginStatus(null)
    expect(s).toMatchObject({ provider: 'codex', loggedIn: false })
    expect(s.detail).toContain('codex login')
  })

  it('ChatGPT-токен → залогинен', () => {
    const raw = JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'tok' } })
    const s = codexLoginStatus(raw)
    expect(s.loggedIn).toBe(true)
    expect(s.detail).toContain('ChatGPT')
  })

  it('API-ключ в файле → залогинен', () => {
    const raw = JSON.stringify({ OPENAI_API_KEY: 'sk-xxx', tokens: null })
    const s = codexLoginStatus(raw)
    expect(s.loggedIn).toBe(true)
    expect(s.detail).toContain('API-ключ')
  })

  it('OPENAI_API_KEY из окружения → залогинен без файла', () => {
    expect(codexLoginStatus(null, true).loggedIn).toBe(true)
  })
})
