import { describe, it, expect, vi } from 'vitest'
import { attachAgentWs } from './wsAgent'
import { AgentRegistry } from './registry'
import { VoiceChatDb } from '../db/database'
import type { WebSocket } from 'ws'

// Фейковый WebSocket: собираем отправленное и эмулируем входящие сообщения.
function fakeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const sent: Array<{ t: string; reason?: string }> = []
  const socket = {
    OPEN: 1, readyState: 1,
    send: (d: string) => sent.push(JSON.parse(d)),
    close: vi.fn(),
    ping: vi.fn(),
    on: (ev: string, cb: (...args: unknown[]) => void) => { handlers.set(ev, cb) }
  } as unknown as WebSocket
  return { socket, sent, message: async (obj: object) => { await handlers.get('message')!(Buffer.from(JSON.stringify(obj)), false) } }
}

describe('attachAgentWs — токены (п.11)', () => {
  it('успешный вход пишет IP и событие; привязка к IP и отзыв отклоняют подключение с событием', async () => {
    const db = new VoiceChatDb(':memory:')
    await db.identity.createUser('bob', 'x', 'developer')
    const created = await db.machines.createAgent('bob', 'Мак')
    const registry = new AgentRegistry()
    let s = fakeSocket()
    attachAgentWs(s.socket, db, registry, { ip: '10.0.0.5' })
    await s.message({ t: 'agent.register', token: created.token, version: '0.15.0' })
    expect(s.sent[0]?.t).toBe('agent.registered')
    expect((await db.machines.listAgents('bob'))[0]!.lastIp).toBe('10.0.0.5')
    await db.machines.setAgentPinIp('bob', created.id, true)
    s = fakeSocket()
    attachAgentWs(s.socket, db, registry, { ip: '10.0.0.9' })
    await s.message({ t: 'agent.register', token: created.token })
    expect(s.sent[0]).toMatchObject({ t: 'agent.denied' })
    expect(s.sent[0]!.reason).toContain('привязан к IP 10.0.0.5')
    await db.machines.revokeAgentToken(created.id)
    s = fakeSocket()
    attachAgentWs(s.socket, db, registry, { ip: '10.0.0.5' })
    await s.message({ t: 'agent.register', token: created.token })
    expect(s.sent[0]).toMatchObject({ t: 'agent.denied', reason: 'Неверный токен' })
    const types = (await db.identity.listSecurityEvents({ user: 'bob' })).map((e) => e.type)
    expect(types).toContain('agent_connected')
    expect(types).toContain('agent_rejected')
  })
})
