import fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { clearPreviewCookies, registerPreviewProxy, storeResponseCookies } from './previewProxy.js'

const target = new URL('http://cache-cycle.machine.internal:5173/asset.css')
async function fixture() {
  const state = { allowed: true, online: true, calls: 0, body: 'first', type: 'text/css', headers: {} as Record<string, string> }
  const app = fastify()
  app.addHook('onRequest', async req => {
    ;(req as unknown as { user: { name: string; role: string } }).user = { name: String(req.headers['x-test-user'] ?? 'cache-alice'), role: 'user' }
  })
  registerPreviewProxy(app, { machines: { canUse: async () => state.allowed, bridge: {
    isOnline: () => state.online,
    http: async () => {
      state.calls++
      return { status: 200, headers: { 'content-type': state.type, ...state.headers }, bodyBase64: Buffer.from(state.body).toString('base64') }
    }
  } } })
  const url = '/api/preview?url=' + encodeURIComponent(target.href)
  return {
    state, app,
    get: (headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers }),
    mutate: () => app.inject({ method: 'POST', url }),
    close: async () => { await app.close(); clearPreviewCookies('cache-alice'); clearPreviewCookies('cache-bob') }
  }
}

describe('Web Reader: кэш ресурсов с проверкой доступа', () => {
  it('повторяет проверку прав до cache hit и условного 304', async () => {
    const f = await fixture()
    try {
      const first = await f.get(); expect(first.statusCode).toBe(200)
      f.state.allowed = false
      expect((await f.get()).statusCode).toBe(403)
      expect((await f.get({ 'if-none-match': String(first.headers.etag) })).statusCode).toBe(403)
      expect(f.state.calls).toBe(1)
    } finally { await f.close() }
  })
  it('разделяет один URL разных пользователей', async () => {
    const f = await fixture()
    try {
      expect((await f.get()).body).toBe('first')
      f.state.body = 'bob'
      expect((await f.get({ 'x-test-user': 'cache-bob' })).body).toBe('bob')
      expect((await f.get()).body).toBe('first')
    } finally { await f.close() }
  })
  it('требует проверки на сервере даже от свежего браузерного кэша', async () => {
    const f = await fixture()
    try { expect((await f.get()).headers['cache-control']).toBe('private, no-cache') } finally { await f.close() }
  })
  it('JSON API всегда читает заново', async () => {
    const f = await fixture()
    try {
      f.state.type = 'application/json'; f.state.body = '{"n":1}'
      await f.get(); f.state.body = '{"n":2}'
      expect((await f.get()).json()).toEqual({ n: 2 })
    } finally { await f.close() }
  })
  it.each([{ 'cache-control': 'private' }, { 'cache-control': 'no-store' }, { vary: 'Accept-Language' }, { 'set-cookie': 'locale=ru; Path=/' }])('не хранит персональный ответ %j', async headers => {
    const f = await fixture()
    try {
      f.state.headers = Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined))
      await f.get(); f.state.body = 'changed'
      expect((await f.get()).body).toBe('changed')
      expect(f.state.calls).toBe(2)
    } finally { await f.close() }
  })
  it('сохраняет no-store независимо от регистра заголовка машины', async () => {
    const f = await fixture()
    try { f.state.headers = { 'Cache-Control': 'no-store' }; expect((await f.get()).headers['cache-control']).toBe('private, no-store') } finally { await f.close() }
  })
  it('авторизованный запрос обходит прежнюю публичную запись', async () => {
    const f = await fixture()
    try {
      await f.get(); f.state.body = 'private'
      expect((await f.get({ 'x-preview-authorization': 'Bearer fixture' })).body).toBe('private')
      storeResponseCookies('cache-alice', target, 'session=fixture; Path=/')
      f.state.body = 'cookie'
      expect((await f.get()).body).toBe('cookie')
    } finally { await f.close() }
  })
  it.each([{ 'cache-control': 'no-cache' }, { pragma: 'no-cache' }, { range: 'bytes=0-10' }])('повторная/частичная загрузка обходит память %j', async headers => {
    const f = await fixture()
    try {
      await f.get(); f.state.body = 'fresh'
      expect((await f.get(Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined)))).body).toBe('fresh')
    } finally { await f.close() }
  })
  it('мутация сбрасывает предыдущие ответы машины', async () => {
    const f = await fixture()
    try {
      await f.get(); f.state.body = 'updated'; await f.mutate()
      expect((await f.get()).body).toBe('updated')
    } finally { await f.close() }
  })
  it('два экземпляра Reader не используют записи чужого моста', async () => {
    const a = await fixture(); const b = await fixture()
    try {
      await a.get(); b.state.body = 'second bridge'
      expect((await b.get()).body).toBe('second bridge')
    } finally { await a.close(); await b.close() }
  })
  it('офлайн-машина не выглядит работающей из-за старого ресурса', async () => {
    const f = await fixture()
    try { await f.get(); f.state.online = false; expect((await f.get()).statusCode).toBe(502) } finally { await f.close() }
  })
})
