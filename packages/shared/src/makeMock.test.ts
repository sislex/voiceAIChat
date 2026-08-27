import { describe, expect, it } from 'vitest'
import { MAKE_MOCK_EXAMPLE, mockCandidates, unwrapMockEnvelope } from './makeMock'

describe('мок-API Make', () => {
  it('кандидаты: метод → общий → index; путь внутри mock/ и «..» не мокируются', () => {
    expect(mockCandidates('api/users', 'get')).toEqual(['mock/api/users.GET.json', 'mock/api/users.json', 'mock/api/users/index.GET.json', 'mock/api/users/index.json'])
    expect(mockCandidates('/api/users/?x=1', 'POST')[0]).toBe('mock/api/users.POST.json')
    expect(mockCandidates('mock/api/users.json', 'GET')).toEqual([])
    expect(mockCandidates('../etc', 'GET')).toEqual([])
  })

  it('конверт: статус, задержка (с потолком), заголовки; без $-полей — тело как есть', () => {
    expect(unwrapMockEnvelope([1, 2])).toMatchObject({ status: 200, body: [1, 2], delayMs: 0 })
    expect(unwrapMockEnvelope({ ok: true })).toMatchObject({ status: 200, body: { ok: true } })
    const r = unwrapMockEnvelope({ $status: 201, $delay: 99999, $headers: { 'X-Total': '2', bad: 5 }, $body: { id: 1 } })
    expect(r).toEqual({ status: 201, body: { id: 1 }, headers: { 'x-total': '2' }, delayMs: 5000 })
    expect(unwrapMockEnvelope({ $status: 204 }).body).toBeNull()
    expect(unwrapMockEnvelope(JSON.parse(MAKE_MOCK_EXAMPLE)).status).toBe(200)
  })
})
