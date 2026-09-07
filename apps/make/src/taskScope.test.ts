import { describe, expect, it } from 'vitest'
import { buildTaskMakeSources, signTaskScope, TASK_SCOPE_TTL_MS, verifyTaskScope } from './taskScope'

const entry = { userId: 'ann', projectId: 'p1', taskId: 't1', sources: [{ conversationId: 'c1', title: 'Макет', mode: 'whole_project' as const, paths: [] }] }

describe('scope-токены рана (make/taskScope.ts)', () => {
  it('подписанный токен читается обратно и несёт срок жизни', () => {
    const token = signTaskScope('s', entry, { now: 1_000 })
    expect(verifyTaskScope('s', token, 1_001)).toEqual({ ...entry, expiresAt: 1_000 + TASK_SCOPE_TTL_MS })
    expect(verifyTaskScope('s', token, 1_000 + TASK_SCOPE_TTL_MS)).toBeNull()
  })

  it('чужой секрет, правленый payload и мусор — null', () => {
    const token = signTaskScope('s', entry)
    expect(verifyTaskScope('other', token)).toBeNull()
    const [, sig] = token.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ ...entry, userId: 'eve', expiresAt: Date.now() + 1e6 })).toString('base64url')
    expect(verifyTaskScope('s', `${forgedPayload}.${sig}`)).toBeNull()
    expect(verifyTaskScope('s', 'garbage')).toBeNull()
    expect(verifyTaskScope('s', '')).toBeNull()
  })

  it('источники рана: один токен на все дизайны, свой conv в каждом URL; без базы или секрета — пусто', () => {
    const designs = [
      { id: 'd1', conversationId: 'c1', title: 'Макет', mode: 'whole_project' as const, paths: [] },
      { id: 'd2', conversationId: 'c2', title: 'Оплата', mode: 'files' as const, paths: ['pay.css'] }
    ] as never[]
    const sources = buildTaskMakeSources({ designs, userId: 'ann', projectId: 'p1', taskId: 't1', baseUrl: 'http://s/mcp/make?k=x', secret: 's', now: 5 })
    expect(sources).toHaveLength(2)
    const tokens = sources.map((s) => new URL(s.mcpUrl).searchParams.get('scope'))
    expect(tokens[0]).toBe(tokens[1])
    expect(sources.map((s) => new URL(s.mcpUrl).searchParams.get('conv'))).toEqual(['c1', 'c2'])
    expect(verifyTaskScope('s', tokens[0]!, 6)?.sources.map((s) => s.conversationId)).toEqual(['c1', 'c2'])
    expect(buildTaskMakeSources({ designs, userId: 'ann', projectId: 'p1', taskId: 't1', secret: 's' })).toEqual([])
    expect(buildTaskMakeSources({ designs, userId: 'ann', projectId: 'p1', taskId: 't1', baseUrl: 'http://s' })).toEqual([])
  })
})
