import { describe, expect, it } from 'vitest'
import { setupRestHarness } from './restHarness.js'

const h = setupRestHarness()
async function create(kind: string, title = 'Chat') { return (await h.inj({ method: 'POST', url: '/api/conversations', payload: { title, assistantKind: kind } })).json() }

describe('Make: выбор браузера чата', () => {
  it('перечисляет Web Reader-сессии пользователя с движком и местом выполнения и привязывает выбранную', async () => {
    const make = await create('make', 'Витрина')
    const proxy = await create('web-recorder', 'Панель')
    const chromium = await create('web-recorder', 'Chromium')
    await h.inj({ method: 'POST', url: `/api/conversations/${chromium.id}/preview-url`, payload: { previewUrl: 'https://example.com/', previewEngine: 'chromium' } })
    const list = (await h.inj({ method: 'GET', url: `/api/conversations/${make.id}/make-browser` })).json()
    expect(list.sessionId).toBeNull()
    expect(list.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: proxy.id, engine: 'panel', place: 'user_panel', available: true }),
      expect.objectContaining({ id: chromium.id, engine: 'chromium', place: 'browser_runner', previewUrl: 'https://example.com/' })
    ]))
    const bound = await h.inj({ method: 'POST', url: `/api/conversations/${make.id}/make-browser`, payload: { sessionId: chromium.id } })
    expect(bound.statusCode).toBe(200)
    expect(bound.json().makeBrowserSessionId).toBe(chromium.id)
    expect((await h.inj({ method: 'GET', url: `/api/conversations/${make.id}/make-browser` })).json().sessionId).toBe(chromium.id)
    expect((await h.inj({ method: 'POST', url: `/api/conversations/${make.id}/make-browser`, payload: { sessionId: null } })).json().makeBrowserSessionId).toBeNull()
  })

  it('не привязывает чужую сессию, обычный чат и не открывает выбор вне Make', async () => {
    const make = await create('make')
    const plain = await create('chat')
    const foreign = await h.db.chat.createConversation('other', 'Чужой', 'web-recorder')
    expect((await h.inj({ method: 'POST', url: `/api/conversations/${make.id}/make-browser`, payload: { sessionId: foreign.id } })).statusCode).toBe(400)
    expect((await h.inj({ method: 'POST', url: `/api/conversations/${make.id}/make-browser`, payload: { sessionId: plain.id } })).statusCode).toBe(400)
    expect((await h.inj({ method: 'POST', url: `/api/conversations/${make.id}/make-browser`, payload: { sessionId: 42 } })).statusCode).toBe(400)
    expect((await h.inj({ method: 'GET', url: `/api/conversations/${plain.id}/make-browser` })).statusCode).toBe(404)
    expect((await h.inj({ method: 'GET', url: `/api/conversations/${make.id}/make-browser` })).json().sessions.map((item: { id: string }) => item.id)).not.toContain(foreign.id)
  })
})
