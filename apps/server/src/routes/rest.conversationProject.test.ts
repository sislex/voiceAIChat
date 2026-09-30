// Маршруты ядра, которые проверялись рядом с канбаном, пока он жил в ядре: удаление машины, адрес
// превью и статус разговора, разговор в проекте. Проекты и их машины заводит канбан, поэтому
// фикстуры пишут в общую базу напрямую.
import { describe, expect, it } from 'vitest'
import { signToken } from "@sislexa/identity/server/users/accounts"
import { setupRestHarness, type InjOpts } from './restHarness.js'

const h = setupRestHarness()
async function asBob(opts: InjOpts) {
  if (!(await h.db.identity.getUser('bob'))) await h.db.identity.createUser('bob', '', 'developer')
  return h.app.inject({ ...opts, headers: { authorization: `Bearer ${signToken({ name: 'bob', role: 'developer' }, h.SECRET)}`, ...(opts.headers ?? {}) } })
}

describe('DELETE /api/agents/:id', () => {
  it('удаляет машину с RESTRICT-связью, а повторно отвечает not found', async () => {
    const machine = await h.db.machines.createAgent(h.U, 'MacBook')
    const storage = await h.db.machines.saveMachineStorage(h.U, machine.id, '/Users/admin/ChatAI', 1)
    const conversation = await h.db.chat.createConversation(h.U, 'Storage')
    await h.db.machines.saveChatStorageBinding(h.U, { conversationId: conversation.id, machineId: machine.id, storageId: storage.id, relativePath: 'chats/chat-1' })

    const first = await h.inj({ method: 'DELETE', url: `/api/agents/${machine.id}` })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toEqual({ ok: true })

    const repeated = await h.inj({ method: 'DELETE', url: `/api/agents/${machine.id}` })
    expect(repeated.statusCode).toBe(404)
    expect(repeated.json()).toEqual({ error: 'not found' })
  })

  it('не раскрывает и не удаляет чужую машину', async () => {
    const machine = await h.db.machines.createAgent(h.U, 'MacBook')
    const response = await asBob({ method: 'DELETE', url: `/api/agents/${machine.id}` })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not found' })
    expect(await h.db.machines.listAgents(h.U)).toHaveLength(1)
  })
})

describe('адрес превью и статус разговора', () => {
  it('хранит override превью, очищает его и принимает только http/https', async () => {
    const conv = await h.db.chat.createConversation(h.U, 'Preview')
    const url = `/api/conversations/${conv.id}/preview-url`
    const saved = await h.inj({ method: 'POST', url, payload: { previewUrl: 'http://localhost:3000/path' } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().previewUrl).toBe('http://localhost:3000/path')
    expect((await h.db.chat.getConversation(h.U, conv.id))?.previewUrl).toBe('http://localhost:3000/path')
    expect((await h.inj({ method: 'POST', url, payload: { previewUrl: 'file:///tmp/x' } })).statusCode).toBe(400)
    expect((await h.inj({ method: 'POST', url, payload: { previewUrl: null } })).json().previewUrl).toBeNull()
    expect((await asBob({ method: 'POST', url, payload: { previewUrl: 'https://example.com' } })).statusCode).toBe(404)
  })

  it('хранит статус, валидирует значение и изолирует владельца', async () => {
    const conv = await h.db.chat.createConversation(h.U, 'Статус')
    expect(conv.status).toBe('developing')
    const url = `/api/conversations/${conv.id}/status`
    const changed = await h.inj({ method: 'POST', url, payload: { status: 'planning_done' } })
    expect(changed.statusCode).toBe(200)
    expect(changed.json().status).toBe('planning_done')
    expect((await h.db.chat.getConversation(h.U, conv.id))?.status).toBe('planning_done')
    expect((await h.inj({ method: 'POST', url, payload: { status: 'unknown' } })).statusCode).toBe(400)
    expect((await asBob({ method: 'POST', url, payload: { status: 'done' } })).statusCode).toBe(404)
  })
})

describe('разговор в проекте', () => {
  it('создание разговора атомарно сохраняет доступный projectId и отвергает чужой', async () => {
    const p = await h.db.projects.createProject(h.U, { name: 'Conversation project' })
    const created = await h.inj({ method: 'POST', url: '/api/conversations', payload: { title: 'Проектный', projectId: p.id } })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ title: 'Проектный', projectId: p.id })
    expect((await h.db.chat.getConversation(h.U, created.json().id))?.projectId).toBe(p.id)

    await h.db.identity.createUser('bob', '', 'developer')
    const before = (await h.db.chat.listConversations('bob')).length
    const denied = await asBob({ method: 'POST', url: '/api/conversations', payload: { title: 'Чужой', projectId: p.id } })
    expect(denied.statusCode).toBe(404)
    expect(await h.db.chat.listConversations('bob')).toHaveLength(before)

    const plain = await asBob({ method: 'POST', url: '/api/conversations', payload: { title: 'Без проекта' } })
    expect(plain.statusCode).toBe(200)
    expect(plain.json().projectId).toBeNull()
  })

  it('привязка чата к проекту сохраняет наследование машины и навыки; не-участник → 404', async () => {
    const p = await h.db.projects.createProject(h.U, { name: 'P', skills: ['ts'] })
    const agent = await h.db.machines.createAgent(h.U, 'M1')
    await h.db.machines.linkMachine(h.U, p.id, agent.id)
    await h.db.machines.setProjectMachinePath(h.U, p.id, agent.id, '/srv/p')
    await h.db.machines.setUserProjectDefaultMachine(h.U, p.id, agent.id)
    const conv = await h.db.chat.createConversation(h.U, 'Chat')
    const linked = await h.inj({ method: 'POST', url: `/api/conversations/${conv.id}/project`, payload: { projectId: p.id } })
    expect(linked.statusCode).toBe(200)
    const c = linked.json() as { execTarget: string | null; workdir: string | null; skillNames: string[]; projectId?: string | null }
    expect(c.projectId).toBe(p.id)
    expect(c.execTarget).toBeNull()
    expect(c.workdir).toBeNull()
    expect(c.skillNames).toEqual(['ts'])
    // Не-участник bob не может привязать свой чат к чужому проекту.
    await h.db.identity.createUser('bob', '', 'developer')
    const convBob = await h.db.chat.createConversation('bob', 'Chat bob')
    expect((await asBob({ method: 'POST', url: `/api/conversations/${convBob.id}/project`, payload: { projectId: p.id } })).statusCode).toBe(404)
  })
})
