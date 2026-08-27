import { describe, expect, it } from 'vitest'
import { MAKE_MOCK_EXAMPLE, applyCollectionRequest, collectionCandidates, isMockCollection, mockCandidates, unwrapMockEnvelope } from './makeMock'

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

describe('persist-коллекции мок-API (roadmap-2 п.12)', () => {
  const col = { $collection: true as const, $body: [{ id: '1', name: 'a' }, { id: '2', name: 'b' }] }
  it('распознаёт коллекцию и делит путь на базу и id', () => {
    expect(isMockCollection(col)).toBe(true)
    expect(isMockCollection([1])).toBe(false)
    expect(collectionCandidates('api/users/42')).toEqual([{ file: 'mock/api/users/42.json', id: null }, { file: 'mock/api/users.json', id: '42' }])
    expect(collectionCandidates('api/users')).toEqual([{ file: 'mock/api/users.json', id: null }, { file: 'mock/api.json', id: 'users' }])
    expect(collectionCandidates('mock/x.json')).toEqual([])
  })
  it('GET список/элемент, POST добавляет с id, PATCH правит, PUT заменяет, DELETE удаляет', () => {
    expect(applyCollectionRequest(col, 'GET', null, null, () => 'x').response.body).toEqual(col.$body)
    expect(applyCollectionRequest(col, 'GET', '2', null, () => 'x').response.body).toEqual({ id: '2', name: 'b' })
    expect(applyCollectionRequest(col, 'GET', '9', null, () => 'x').response.status).toBe(404)
    const posted = applyCollectionRequest(col, 'POST', null, { name: 'c' }, () => 'gen')
    expect(posted.response).toMatchObject({ status: 201, body: { id: 'gen', name: 'c' } })
    expect((posted.file as { $body: unknown[] }).$body).toHaveLength(3)
    expect(applyCollectionRequest(col, 'PATCH', '1', { name: 'z' }, () => 'x').response.body).toEqual({ id: '1', name: 'z' })
    expect(applyCollectionRequest(col, 'PUT', '1', { title: 'only' }, () => 'x').response.body).toEqual({ title: 'only', id: '1' })
    const del = applyCollectionRequest(col, 'DELETE', '2', null, () => 'x')
    expect(del.response.status).toBe(204)
    expect((del.file as { $body: unknown[] }).$body).toHaveLength(1)
    expect(applyCollectionRequest(col, 'POST', '1', {}, () => 'x').response.status).toBe(405)
  })
})
