import { describe, expect, it } from 'vitest'
import { createPreviewTurnTokens } from './turnToken.js'

describe('подписанные токены ходов превью', () => {
  it('binds CI evidence to the signed run, step and exact target across processes', () => {
    const entry = { userId: 'ann', conversationId: 'c1', ciCheck: { runId: 'r1', stepId: 's1', url: 'http://agent.machine.internal:5173/#/releases' } }
    const token = createPreviewTurnTokens('s').issue(entry)
    expect(createPreviewTurnTokens('s').verify(token)).toEqual(entry)
    const [, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ u: 'ann', c: 'c1', e: Date.now() + 10000, check: { ...entry.ciCheck, stepId: 's2' } })).toString('base64url')
    expect(createPreviewTurnTokens('s').verify(`${forged}.${signature}`)).toBeUndefined()
  })

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
