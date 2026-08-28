import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import { AgentRegistry } from './agents/registry.js'
import { signToken } from './users/accounts.js'

// Долгие команды (machines-roadmap п.17): команда из чата, дольше порога, сохраняет полный лог в
// `<хранилище чата>/artifacts/commands/` на машине. Порог здесь 0 — «долгой» считается любая.
const U = 'admin'
let app: FastifyInstance
let db: VoiceChatDb
let registry: AgentRegistry
let dataDir: string
let token: string

function connectAgent(machineId: string) {
  const files = new Map<string, string>()
  const directories = new Set<string>()
  const socket = {
    close: vi.fn(),
    send(data: string) {
      const m = JSON.parse(data) as { t: string; opId?: string; path?: string; dataBase64?: string; execId?: string; command?: string }
      const ok = (result: object) => registry.handleMessage(machineId, { t: 'fs.result', opId: m.opId!, result: { root: '/', cwd: m.path ?? '/', ...result } })
      if (m.t === 'exec.start') {
        registry.handleMessage(machineId, { t: 'exec.chunk', execId: m.execId!, stream: 'stdout', data: `out of ${m.command}` })
        registry.handleMessage(machineId, { t: 'exec.done', execId: m.execId!, exitCode: 0 })
      } else if (m.t === 'fs.mkdir') { directories.add(m.path!); ok({}) }
      else if (m.t === 'fs.write') { files.set(m.path!, m.dataBase64 ?? ''); ok({}) }
      else if (m.t === 'fs.read') {
        const d = files.get(m.path!)
        if (d === undefined) registry.handleMessage(machineId, { t: 'fs.error', opId: m.opId!, message: 'ENOENT' })
        else ok({ dataBase64: d })
      } else if (m.t === 'fs.list') ok({ entries: [] })
      else if (m.t === 'fs.delete') { files.delete(m.path!); ok({}) }
    }
  }
  registry.register(machineId, 'Мак', socket, db.listAgents(U).find((a) => a.id === machineId)!.policy, '0.15.0')
  return { files, directories }
}

beforeEach(async () => {
  db = new VoiceChatDb(':memory:')
  dataDir = join(tmpdir(), `vc-cmd-notify-${Date.now()}`)
  registry = new AgentRegistry()
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: dataDir, VC_MODELS_DIR: join(dataDir, 'models'), VC_PIPER_VOICES_DIR: join(dataDir, 'voices'), VC_LONG_COMMAND_MS: '0' }),
    db,
    agentRegistry: registry,
    sessionSecret: 'secret'
  })
  token = signToken({ name: U, role: 'admin' }, 'secret')
})
afterEach(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }) })

describe('уведомления о долгих командах', () => {
  it('команда из чата пишет полный лог в artifacts/commands хранилища чата; консольная — нет', async () => {
    const machine = db.createAgent(U, 'Мак')
    const fs = connectAgent(machine.id)
    const inj = (opts: { method: 'GET' | 'POST' | 'PUT'; url: string; payload?: object }) => app.inject({ ...opts, headers: { authorization: `Bearer ${token}` } })
    const storage = (await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI' } })).json()
    const conv = db.createConversation(U, 'C')
    expect((await inj({ method: 'PUT', url: `/api/conversations/${conv.id}/storage`, payload: { machineId: machine.id, storageId: storage.id } })).statusCode).toBe(200)

    await registry.exec(machine.id, 'npm test', 1000, undefined, { source: 'chat', userId: U, conversationId: conv.id })
    await vi.waitFor(() => {
      const logs = [...fs.files.keys()].filter((p) => p.includes(`/chats/${conv.id}/artifacts/commands/`))
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatch(/__npm-test\.log$/)
      expect(Buffer.from(fs.files.get(logs[0]!)!, 'base64').toString('utf8')).toContain('$ npm test\n# exit 0')
      expect(Buffer.from(fs.files.get(logs[0]!)!, 'base64').toString('utf8')).toContain('out of npm test')
    })

    await registry.exec(machine.id, 'uptime', 1000, undefined, { source: 'console', userId: U })
    await new Promise((r) => setTimeout(r, 20))
    expect([...fs.files.keys()].filter((p) => p.includes('/artifacts/commands/'))).toHaveLength(1)
    // журнал получил обе команды
    expect(db.listMachineCommands(machine.id).map((r) => r.command)).toEqual(['uptime', 'npm test'])
  })
})
