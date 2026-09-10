import { beforeEach, describe, expect, it } from 'vitest'
import { setupRestHarness } from '../routes/restHarness.js'

const harness = setupRestHarness()
let cookie = ''
let token = ''
beforeEach(async () => {
  await harness.db.identity.createUser('reader-session', 'fixture-password', 'developer')
  const login = await harness.app.inject({ method: 'POST', url: '/api/session/login', payload: { name: 'reader-session', password: 'fixture-password' } })
  expect(login.statusCode).toBe(200)
  token = login.json().token
  cookie = ([] as string[]).concat(login.headers['set-cookie'] as string[]).map(line => line.split(';')[0]).join('; ')
})

describe('Reader: специальная сессия не перекрывается обычной cookie', () => {
  it('форма страницы проходит на точном proxy-пути без CSRF внешней оболочки', async () => {
    const response = await harness.app.inject({ method: 'POST', url: '/api/preview?url=' + encodeURIComponent('http://reader.test/api/preview/diagnostics'), headers: { cookie, host: 'reader.test', 'content-type': 'application/x-www-form-urlencoded' }, payload: 'field=value' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
  })
  it('сброс cookie сайта доступен панели при обычной cookie-сессии оболочки', async () => {
    expect((await harness.app.inject({ method: 'POST', url: '/api/preview/reset-cookies', headers: { cookie }, payload: {} })).statusCode).toBe(200)
  })
  it('остальной API продолжает требовать CSRF для мутации', async () => {
    const response = await harness.app.inject({ method: 'POST', url: '/api/conversations', headers: { cookie }, payload: { title: 'must not create' } })
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('csrf')
  })
  it('preview-cookie не даёт доступ к остальному API', async () => {
    expect((await harness.app.inject({ method: 'GET', url: '/api/conversations', headers: { cookie: `vc_preview_session=${token}` } })).statusCode).toBe(401)
    expect((await harness.app.inject({ method: 'POST', url: '/api/preview-other', headers: { cookie: `vc_preview_session=${token}` }, payload: {} })).statusCode).toBe(401)
  })
  it('обычная cookie без preview-cookie всё ещё требует CSRF даже на прокси', async () => {
    const response = await harness.app.inject({ method: 'POST', url: '/api/preview/reset-cookies', headers: { cookie: `vc_session=${token}` }, payload: {} })
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('csrf')
  })
  it('недействительная preview-cookie не разрешает запрос', async () => {
    const response = await harness.app.inject({ method: 'POST', url: '/api/preview/reset-cookies', headers: { cookie: `vc_preview_session=invalid; vc_session=${token}` }, payload: {} })
    expect(response.statusCode).toBe(401)
  })
})
