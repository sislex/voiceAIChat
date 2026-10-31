import { describe, it, expect, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { attachAgentWs } from './wsAgent'
import { AgentRegistry } from './registry'
import { VoiceChatDb } from '../db/database'
import type { WebSocket } from 'ws'
import type { AgentRegister } from '@voicechat/shared'

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

describe('attachAgentWs dependency failures', () => {
  it('closes and cleans up when Identity fails after sending an update offer', async () => {
    const db = new VoiceChatDb(':memory:')
    await db.identity.createUser('bob', 'x', 'developer')
    const created = await db.machines.createAgent('bob', 'Mac')
    const registry = new AgentRegistry()
    const unregister = vi.spyOn(registry, 'unregister')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const audit = vi.spyOn(db.identity, 'logSecurityEvent')
    audit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('Identity unavailable'), { statusCode: 503 }))
    const s = fakeSocket()
    try {
      attachAgentWs(s.socket, db, registry)
      await s.message({ t: 'agent.register', token: created.token, version: '0.1.0', supervisor: 'launchd' })
      expect(s.socket.close).toHaveBeenCalledWith(1013, expect.stringContaining('retry'))
      expect(unregister).toHaveBeenCalledWith(created.id)
      expect(log).toHaveBeenCalled()
      await s.message({ t: 'agent.register', token: created.token })
      expect(audit).toHaveBeenCalledTimes(2)
    } finally {
      log.mockRestore()
      await db.close()
    }
  })

  it.each(['connected', 'rejected', 'pong', 'close'])('survives %s failure in a strict Node process and serves the next connection', async (failure) => {
    const script = `
      import assert from 'node:assert/strict'
      import { once } from 'node:events'
      import { WebSocket, WebSocketServer } from 'ws'
      import { attachAgentWs } from ${JSON.stringify(new URL('./wsAgent.ts', import.meta.url).href)}
      import { createIdentityStoreClient } from '@sislexa/identity/client/rpc'
      const failure = ${JSON.stringify(failure)}
      const { DependencyUnavailable } = await import('@sislexa/component-runtime')
      const unavailable = new DependencyUnavailable('identity')
      let down = true, registered = 0, unregistered = 0, rpcCalls = 0
      const db = {
        identity: createIdentityStoreClient({ url: 'http://identity.invalid', token: 'test', fetchImpl: async () => {
          rpcCalls++
          if (down) throw unavailable
          return new Response(JSON.stringify({ result: null }))
        }}),
        machines: {
          findAgentByTokenHash: async () => ({ id: 'agent', name: 'Mac', userId: 'bob',
            tokenExpiresAt: failure === 'rejected' && down ? 0 : null, policy: {} }),
          touchAgent: async () => { if (down && (failure === 'pong' || failure === 'close')) throw unavailable }
        }
      }
      const registry = { register: () => { registered++ }, unregister: () => { unregistered++ } }
      const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
      server.on('connection', socket => attachAgentWs(socket, db, registry))
      await once(server, 'listening')
      const url = 'ws://127.0.0.1:' + server.address().port
      async function connect() {
        const socket = new WebSocket(url)
        await once(socket, 'open')
        return socket
      }
      if (failure === 'pong' || failure === 'close') down = false
      const first = await connect()
      const closed = once(first, 'close')
      const message = failure === 'pong' || failure === 'close' ? once(first, 'message') : null
      first.send(JSON.stringify({ t: 'agent.register', token: 'test' }))
      if (message) {
        await message
        down = true
        if (failure === 'pong') first.pong()
        else first.close()
      }
      const [code] = await closed
      if (failure !== 'close') assert.equal(code, 1013)
      await new Promise(resolve => setTimeout(resolve, 30))
      assert.equal(unregistered, registered)
      assert.ok(rpcCalls > 0)
      down = false
      const second = await connect()
      const reply = once(second, 'message')
      second.send(JSON.stringify({ t: 'agent.register', token: 'test' }))
      assert.equal(JSON.parse(String((await reply)[0])).t, 'agent.registered')
      const secondClosed = once(second, 'close')
      second.close()
      await secondClosed
      await new Promise(resolve => setTimeout(resolve, 30))
      assert.equal(unregistered, registered)
      await new Promise(resolve => server.close(resolve))
      console.log('server survived')
    `
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ['--unhandled-rejections=strict', '--import', 'tsx', '--input-type=module', '--eval', script],
      { timeout: 15_000 })
    expect(stdout).toContain('server survived')
    expect(stderr).toContain('DependencyUnavailable')
    expect(stderr).toContain('[agent-ws]')
  }, 20_000)
})

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
    return { s, db, registry, id: created.id, token: created.token, events }
  }

  it.each(['systemd', 'launchd', 'android'] as const)('sends agent.update once to an older %s agent and logs it', async (supervisor) => {
    const registration = { version: '0.24.0', supervisor } satisfies Pick<AgentRegister, 'version' | 'supervisor'>
    const { s, db, registry, id, token, events } = await connect(registration)
    expect(s.sent.map((m) => m.t)).toEqual(['agent.registered', 'agent.update'])
    expect(s.sent[1]).toEqual({ t: 'agent.update', version: '0.25.0', sha256: served.sha256 })
    expect(events).toContain('agent_update_sent')
    await s.message({ t: 'agent.updateResult', status: 'applied', message: 'restarting' })
    expect(registry.updateStatusOf(id)).toMatchObject({ status: 'applied', message: 'restarting' })
    await s.message({ t: 'agent.register', token, ...registration })
    expect(s.sent.filter((m) => m.t === 'agent.update')).toHaveLength(1)
    const updates = (await db.identity.listSecurityEvents({ user: 'bob' })).filter((e) => e.type === 'agent_update_sent')
    expect(updates).toHaveLength(1)
    expect(updates[0]!.details).toContain(`(${supervisor})`)
  })

  it.each([undefined, 'cron'])('keeps the version-gated hint for supervisor %s', async (supervisor) => {
    const { s, registry, id, events } = await connect({ version: '0.1.0', supervisor })
    await expect(registry.fsList(id, '')).rejects.toThrow(/устарел/i)
    expect(s.sent.map((m) => m.t)).toEqual(['agent.registered', 'agent.updateAvailable'])
    expect(events).not.toContain('agent_update_sent')
  })

  it('does not send agent.update for equal/newer versions or unsupervised agents', async () => {
    for (const register of [{ version: '0.25.0', supervisor: 'launchd' }, { version: '0.26.0', supervisor: 'systemd' }, { version: '0.25.0', supervisor: 'android' }, { version: '0.26.0', supervisor: 'android' }, { version: '0.24.0' }, { version: '0.24.0', supervisor: 'cron' }]) {
      const { s, events } = await connect(register)
      expect(s.sent.map((m) => m.t)).toEqual(['agent.registered'])
      expect(events).not.toContain('agent_update_sent')
    }
  })
})
