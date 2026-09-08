import { describe, expect, it } from 'vitest'
import { createPreviewTurnTokens } from './turnToken.js'

describe('подписанные токены ходов превью', () => {
  it('выданный токен проверяется в другом экземпляре с тем же секретом (другой процесс)', () => {
    const a = createPreviewTurnTokens('s')
    const b = createPreviewTurnTokens('s')
    const token = a.issue({ userId: 'ann', conversationId: 'c1' })
    expect(b.verify(token)).toEqual({ userId: 'ann', conversationId: 'c1' })
  })

  it('чужой секрет, подмена полезной нагрузки и мусор — отказ', () => {
    const tokens = createPreviewTurnTokens('s')
    const token = tokens.issue({ userId: 'ann', conversationId: 'c1' })
    expect(createPreviewTurnTokens('other').verify(token)).toBeUndefined()
    const [payload, sig] = token.split('.') as [string, string]
    const forged = Buffer.from(JSON.stringify({ u: 'admin', c: 'c1', e: Date.now() + 1e6 })).toString('base64url')
    expect(tokens.verify(`${forged}.${sig}`)).toBeUndefined()
    expect(tokens.verify(payload)).toBeUndefined()
    expect(tokens.verify('')).toBeUndefined()
    expect(tokens.verify('turn-token')).toBeUndefined()
  })

  it('срок жизни: после exp токен недействителен', () => {
    let clock = 1_000_000
    const tokens = createPreviewTurnTokens('s', { ttlMs: 1_000, now: () => clock })
    const token = tokens.issue({ userId: 'ann', conversationId: 'c1' })
    clock += 999
    expect(tokens.verify(token)).toBeDefined()
    clock += 2
    expect(tokens.verify(token)).toBeUndefined()
  })
})
