import { describe, it, expect, vi } from 'vitest'
import { attachAgentWs } from './wsAgent'
import { AgentRegistry } from './registry'
import { VoiceChatDb } from '../db/database'
import type { WebSocket } from 'ws'

const served = vi.hoisted(() => ({ version: '0.25.0', sha256: 'ab'.repeat(32) }))
vi.mock('./agentScript.js', () => ({ servedAgent: () => served }))

// Фейковый WebSocket: собираем отправленное и эмулируем входящие сообщения.
function fakeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const sent: Array<{ t: string; reason?: string; version?: string; sha256?: string }> = []
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

describe('attachAgentWs — self-update (stand-https-v1 C01)', () => {
  async function connect(register: Record<string, unknown>) {
    const db = new VoiceChatDb(':memory:')
    await db.identity.createUser('bob', 'x', 'developer')
    const created = await db.machines.createAgent('bob', 'Мак')
    const registry = new AgentRegistry()
    const s = fakeSocket()
    attachAgentWs(s.socket, db, registry)
    await s.message({ t: 'agent.register', token: created.token, ...register })
    const events = (await db.identity.listSecurityEvents({ user: 'bob' })).map((e) => e.type)
    return { s, db, registry, id: created.id, events }
  }

  it('sends agent.update once to a supervised agent older than the served bundle and logs it', async () => {
    const { s, registry, id, events } = await connect({ version: '0.24.0', supervisor: 'systemd' })
    expect(s.sent.map((m) => m.t)).toEqual(['agent.registered', 'agent.update'])
    expect(s.sent[1]).toEqual({ t: 'agent.update', version: '0.25.0', sha256: served.sha256 })
    expect(events).toContain('agent_update_sent')
    await s.message({ t: 'agent.updateResult', status: 'applied', message: 'restarting' })
    expect(registry.updateStatusOf(id)).toMatchObject({ status: 'applied', message: 'restarting' })
    expect(s.sent.filter((m) => m.t === 'agent.update')).toHaveLength(1)
  })

  it('does not send agent.update for equal versions or unsupervised agents', async () => {
    for (const register of [{ version: '0.25.0', supervisor: 'launchd' }, { version: '0.26.0', supervisor: 'systemd' }, { version: '0.24.0' }, { version: '0.24.0', supervisor: 'cron' }]) {
      const { s, events } = await connect(register)
      expect(s.sent.map((m) => m.t)).toEqual(['agent.registered'])
      expect(events).not.toContain('agent_update_sent')
    }
  })
})
