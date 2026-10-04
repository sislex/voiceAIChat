import { describe, expect, it, vi } from 'vitest'
import { REST, stripServiceData, type TurnMeta } from '@voicechat/shared'
import { setupRestHarness } from './restHarness.js'
import { UserFrameHub } from '../frameHub.js'

const h = setupRestHarness()
const meta: TurnMeta = {
  activity: [{ kind: 'thinking', summary: 'Thinking', raw: 'private trace' }],
  request: { provider: 'claude', model: 'sonnet', prompt: 'private prompt', promptChars: 14, resumed: false },
  inputTokens: 42
}

async function setting(id: string, enabled: boolean) {
  const current = (await h.db.settings.getChatSettings(h.U, id))!
  const response = await h.inj({ method: 'PATCH', url: `/api/conversations/${id}/settings`,
    payload: { version: 1, owner: 'conversation', expectedRevision: current.revision, values: { loadServiceData: enabled } } })
  expect(response.statusCode).toBe(200)
  expect((await h.db.settings.getChatSettings(h.U, id))?.conversation.loadServiceData).toBe(enabled)
}

describe('service data transport', () => {
  it.each([false, true])('projects conversation, admin, writes and chat.message with enabled=%s', async enabled => {
    const c = await h.db.chat.createConversation(h.U, 'Service data')
    await setting(c.id, enabled)
    const publish = vi.spyOn(UserFrameHub.prototype, 'publish')
    try {
      const response = await h.inj({ method: 'POST', url: `/api/conversations/${c.id}/messages`, payload: { role: 'ai', text: 'Answer', time: '10:00', meta } })
      expect(response.statusCode).toBe(200)
      const message = response.json()
      const expected = enabled ? meta : stripServiceData(meta)
      expect(message.meta).toEqual(expected)
      expect(publish.mock.calls.find(([event]) => event.t === 'chat.message')?.[0]).toMatchObject({ message: { meta: expected } })
      expect((await h.inj({ method: 'GET', url: `/api/conversations/${c.id}` })).json().messages[0].meta).toEqual(expected)
      expect((await h.inj({ method: 'GET', url: `${REST.adminUserMessages(h.U)}?conversationId=${c.id}` })).json()[0].meta).toEqual(expected)
      const patched = await h.inj({ method: 'PATCH', url: `/api/conversations/${c.id}/messages/${message.id}`, payload: { meta: { taskLaunches: [] } } })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().meta).toEqual({ ...expected, taskLaunches: [] })
      expect((await h.db.chat.listMessages(h.U, c.id))[0].meta).toEqual({ ...meta, taskLaunches: [] })
      const echoed = await h.inj({ method: 'PATCH', url: `/api/conversations/${c.id}/messages/${message.id}`,
        payload: { meta: { ...stripServiceData(meta), taskLaunches: [] } } })
      expect(echoed.statusCode).toBe(200)
      expect(echoed.json().meta).toEqual({ ...expected, taskLaunches: [] })
      expect((await h.db.chat.listMessages(h.U, c.id))[0].meta).toEqual({ ...meta, taskLaunches: [] })
      const service = await h.inj({ method: 'GET', url: REST.messageServiceData(c.id, message.id) })
      expect(service.statusCode).toBe(enabled ? 200 : 409)
      if (enabled) expect(service.json()).toEqual({ activity: meta.activity, request: meta.request })
    } finally { publish.mockRestore() }
  })

  it.each([false, true])('projects draft replays and kanban ensure with enabled=%s', async enabled => {
    const payload = { idempotencyKey: 'service-draft', title: 'Draft', message: { role: 'ai', text: 'Answer', time: '10:00', meta } }
    const initial = await h.inj({ method: 'POST', url: REST.conversationDraft, payload })
    expect(initial.statusCode).toBe(200)
    expect(initial.json().messages[0].meta).toEqual(stripServiceData(meta))
    await setting(initial.json().conversation.id, enabled)
    const replay = await h.inj({ method: 'POST', url: REST.conversationDraft, payload })
    expect(replay.json().messages[0].meta).toEqual(enabled ? meta : stripServiceData(meta))
    const project = await h.db.projects.createProject(h.U, { name: 'Assistant' })
    const url = `/api/projects/${project.id}/kanban-assistant`
    const ensured = await h.inj({ method: 'GET', url })
    expect(ensured.statusCode).toBe(200)
    const id = ensured.json().conversation.id
    const message = await h.db.chat.addMessage(h.U, id, 'ai', 'Answer', '10:00', undefined, meta)
    await setting(id, enabled)
    expect((await h.inj({ method: 'GET', url })).json().messages[0].meta).toEqual(enabled ? meta : stripServiceData(meta))
    const serviceUrl = REST.messageServiceData(id, message.id)
    expect((await h.inj({ method: 'GET', url: serviceUrl })).statusCode).toBe(404)
    expect((await h.inj({ method: 'GET', url: `${serviceUrl}?scope=kanban` })).statusCode).toBe(400)
    expect((await h.inj({ method: 'GET', url: `${serviceUrl}?scope=kanban&projectId=${project.id}` })).statusCode).toBe(enabled ? 200 : 409)
  })

  it('enforces conversation and message ownership and handles absent diagnostics', async () => {
    const c = await h.db.chat.createConversation(h.U, 'Own')
    const foreign = await h.db.chat.createConversation('another-user', 'Private')
    const foreignMessage = await h.db.chat.addMessage('another-user', foreign.id, 'ai', 'Private', '10:00', undefined, meta)
    await setting(c.id, true)
    for (const url of [REST.messageServiceData(foreign.id, foreignMessage.id), REST.messageServiceData(c.id, foreignMessage.id), REST.messageServiceData('missing', 'missing')]) {
      expect((await h.inj({ method: 'GET', url })).statusCode).toBe(404)
    }
    expect((await h.app.inject({ method: 'GET', url: REST.messageServiceData(c.id, 'missing') })).statusCode).toBe(401)
    const settings = (await h.db.settings.getChatSettings(h.U, c.id))!
    expect((await h.inj({ method: 'PATCH', url: `/api/conversations/${c.id}/settings`,
      payload: { version: 1, owner: 'conversation', expectedRevision: settings.revision, values: { loadServiceData: 'true' } } })).statusCode).toBe(400)
    const plain = await h.db.chat.addMessage(h.U, c.id, 'u1', 'Plain', '10:00')
    expect((await h.inj({ method: 'GET', url: REST.messageServiceData(c.id, plain.id) })).json()).toEqual({})
    await expect(h.db.chat.updateMessageMeta(h.U, foreign.id, foreignMessage.id, {})).rejects.toThrow('message not found')
  })
})
