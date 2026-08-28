import { describe, expect, it } from 'vitest'
import { MAKE_MOCK_EXAMPLE, applyAuthMock, applyCollectionRequest, collectionCandidates, isAuthMock, isMockCollection, mockCandidates, unwrapMockEnvelope } from './makeMock'

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

describe('коллекция с $schema (roadmap-4 п.31)', () => {
  const col = { $collection: true as const, $schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 2 } } }, $body: [{ id: 1, name: 'Анна' }] }
  it('POST с невалидным телом → 422 с issues, файл не меняется; валидное → 201', () => {
    const bad = applyCollectionRequest(col, 'POST', null, { name: 'A' }, () => 'x')
    expect(bad.response.status).toBe(422)
    expect(bad.changed).toBe(false)
    expect((bad.response.body as { issues: Array<{ path: string }> }).issues[0]!.path).toBe('name')
    expect(applyCollectionRequest(col, 'POST', null, { name: 'Борис' }, () => 'x').response.status).toBe(201)
  })
  it('PATCH проверяет только присланные поля (required не требуется)', () => {
    expect(applyCollectionRequest(col, 'PATCH', '1', { extra: 1 }, () => 'x').response.status).toBe(200)
    expect(applyCollectionRequest(col, 'PATCH', '1', { name: '' }, () => 'x').response.status).toBe(422)
  })
})

describe('auth-мок (roadmap-4 п.32)', () => {
  const login = { $auth: { users: [{ username: 'anna', password: '1234', name: 'Анна' }] }, $body: { ok: true } }
  it('POST с верными данными — 200, user без пароля, Set-Cookie; неверные — 401; не POST — 405', () => {
    const ok = applyAuthMock(login, 'POST', { username: 'anna', password: '1234' }, undefined)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ ok: true, user: { username: 'anna', name: 'Анна' } })
    expect(ok.headers['set-cookie']).toBe('vc_mock_session=anna; Path=/; SameSite=Lax')
    expect(applyAuthMock(login, 'POST', { username: 'anna', password: 'x' }, undefined).status).toBe(401)
    expect(applyAuthMock(login, 'GET', undefined, undefined).status).toBe(405)
  })
  it('require: без cookie 401, с cookie — тело с user; logout гасит cookie', () => {
    const me = { $auth: { require: true }, $body: { role: 'admin' } }
    expect(applyAuthMock(me, 'GET', undefined, undefined).status).toBe(401)
    expect(applyAuthMock(me, 'GET', undefined, 'x=1; vc_mock_session=anna').body).toEqual({ role: 'admin', user: { username: 'anna' } })
    const out = applyAuthMock({ $auth: { logout: true } }, 'POST', undefined, undefined)
    expect(out.status).toBe(204)
    expect(out.headers['set-cookie']).toContain('Max-Age=0')
    expect(isAuthMock(me)).toBe(true); expect(isAuthMock({ $body: 1 })).toBe(false)
  })
})
