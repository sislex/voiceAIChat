// Машины: хранилище, журнал команд, доступ участников, политика, токены, метрики, утилиты.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { VoiceChatDb, hashAgentToken } from '../db/database.js'
import { signToken } from '../users/accounts.js'
import type { FastifyInstance } from 'fastify'
import { AgentRegistry } from '../agents/registry.js'
import { setupRestHarness, type InjOpts } from './restHarness.js'

// Обвязка одна на все rest.*.test.ts — см. restHarness.ts.
// Хук harness зарегистрирован первым, поэтому к моменту этого beforeEach
// поля уже пересозданы под текущий тест.
const harness = setupRestHarness()
const { inj, SECRET, U } = harness
let app: FastifyInstance
let db: VoiceChatDb
let token: string
let agentRegistry: AgentRegistry
beforeEach(() => { ({ app, db, token, agentRegistry } = harness) })


describe('REST: хранилище машины', () => {
  function connectFs(machineId: string, failMkdir = false, failWrite = false) {
    const directories = new Set<string>()
    let writeBlocked = failWrite
    const files = new Map<string, string>()
    const socket = {
      close: vi.fn(),
      send(data: string) {
        const message = JSON.parse(data) as { t: string; opId?: string; path?: string; dataBase64?: string }
        if (!message.opId || !message.path) return
        if (message.t === 'fs.mkdir') {
          if (failMkdir) return agentRegistry.handleMessage(machineId, { t: 'fs.error', opId: message.opId, message: 'EACCES permission denied' })
          directories.add(message.path)
          return agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path } })
        }
        if (message.t === 'fs.write') {
          if (writeBlocked) return agentRegistry.handleMessage(machineId, { t: 'fs.error', opId: message.opId, message: 'EROFS read-only file system' })
          files.set(message.path, message.dataBase64 ?? '')
          return agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path } })
        }
        if (message.t === 'fs.delete') {
          files.delete(message.path)
          return agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path } })
        }
        if (message.t === 'fs.read') {
          const dataBase64 = files.get(message.path)
          return dataBase64 === undefined
            ? agentRegistry.handleMessage(machineId, { t: 'fs.error', opId: message.opId, message: 'ENOENT not found' })
            : agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path, dataBase64 } })
        }
        if (message.t === 'fs.list') {
          return directories.has(message.path)
            ? agentRegistry.handleMessage(machineId, { t: 'fs.result', opId: message.opId, result: { root: '/', cwd: message.path, entries: [] } })
            : agentRegistry.handleMessage(machineId, { t: 'fs.error', opId: message.opId, message: 'ENOENT missing disk' })
        }
      }
    }
    agentRegistry.register(machineId, 'Мак', socket, db.listAgents(U).find((item) => item.id === machineId)!.policy, '0.11.0')
    return { directories, files, setFailWrite: (value: boolean) => { writeBlocked = value } }
  }

  it('готовит marker до записи в БД, сохраняет id и проверяет фактический status', async () => {
    const machine = db.createAgent(U, 'Мак')
    const fs = connectFs(machine.id)
    const first = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI' } })
    expect(first.statusCode).toBe(200)
    expect(db.listMachineStorages(U, machine.id)).toHaveLength(1)
    expect(fs.directories).toContain('/Users/me/ChatAI/.voicechat/temporary')
    const second = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI/' } })
    expect(second.json().id).toBe(first.json().id)
    const listed = await inj({ method: 'GET', url: `/api/agents/${machine.id}/storages` })
    expect(listed.json()[0]).toMatchObject({ id: first.json().id, status: 'ready', primary: true })
  })

  it('материализует каталоги и project marker до сохранения машины проекта', async () => {
    const machine = db.createAgent(U, 'Project machine')
    const fs = connectFs(machine.id)
    const storageResponse = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI' } })
    const projectResponse = await inj({ method: 'POST', url: '/api/projects', payload: { name: 'Managed project' } })
    const projectId = projectResponse.json().id as string
    const linked = await inj({ method: 'POST', url: `/api/projects/${projectId}/machines`, payload: { agentId: machine.id, storageId: storageResponse.json().id } })
    expect(linked.statusCode).toBe(200)
    const configured = linked.json().machines.find((item: { agentId: string }) => item.agentId === machine.id)
    expect(configured.path).toContain(`/projects/${projectId}/worktree`)
    expect(configured.reposRoot).toContain(`/projects/${projectId}/repositories`)
    expect(fs.directories).toContain(`/Users/me/ChatAI/projects/${projectId}/environments/production`)
    const marker = Buffer.from(fs.files.get(`/Users/me/ChatAI/projects/${projectId}/project.json`) ?? '', 'base64').toString('utf8')
    expect(JSON.parse(marker)).toMatchObject({ formatVersion: 1, projectId })
  })

  it('показывает зарегистрированное хранилище только для чтения', async () => {
    const machine = db.createAgent(U, 'Read only')
    const fs = connectFs(machine.id)
    const created = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Volumes/ReadOnly/ChatAI' } })
    expect(created.statusCode).toBe(200)
    fs.setFailWrite(true)
    const listed = await inj({ method: 'GET', url: `/api/agents/${machine.id}/storages` })
    expect(listed.json()[0]).toMatchObject({ status: 'read-only', error: expect.stringContaining('только для чтения') })
    expect(fs.files.size).toBeGreaterThan(0)
  })

  it('не оставляет ready-запись при ошибке прав', async () => {
    const machine = db.createAgent(U, 'Закрытый диск')
    connectFs(machine.id, true)
    const response = await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Volumes/Locked/ChatAI' } })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toMatch(/Нет прав/)
    expect(db.listMachineStorages(U, machine.id)).toEqual([])
  })

  it('bootstrap проектного чата создаёт каталоги окружений, но не пишет environment.json (иначе poisoned manifest → деплой 400)', async () => {
    const machine = db.createAgent(U, 'Мак')
    const fs = connectFs(machine.id)
    const storage = (await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI' } })).json()
    const project = db.createProject(U, { name: 'ChatAI', gitUrl: 'https://example.com/repo.git' })
    const conv = db.createConversation(U, 'C')
    db.setConversationProject(U, conv.id, project.id)
    const res = await inj({ method: 'PUT', url: `/api/conversations/${conv.id}/storage`, payload: { machineId: machine.id, storageId: storage.id } })
    expect(res.statusCode).toBe(200)
    const written = [...fs.files.keys()]
    // Каталоги managed-окружений создаются, а манифест — нет (его пишут релиз/preview-менеджеры).
    expect([...fs.directories].some((d) => d.includes('/environments/production/'))).toBe(true)
    expect(written.some((p) => p.endsWith('/environment.json'))).toBe(false)
    // Обычные маркеры хранилища при этом на месте.
    expect(written.some((p) => p.endsWith('/project.json'))).toBe(true)
  })

  it('copy-to копирует файл на другую машину: в указанный каталог или в ChatAI/incoming цели', async () => {
    const source = db.createAgent(U, 'Мак')
    const target = db.createAgent(U, 'Прод')
    const sourceFs = connectFs(source.id)
    const targetFs = connectFs(target.id)
    sourceFs.files.set('/Users/me/report.txt', Buffer.from('hello').toString('base64'))
    const explicit = await inj({ method: 'POST', url: `/api/agents/${source.id}/fs/copy-to`, payload: { path: '/Users/me/report.txt', targetAgentId: target.id, targetDir: '/srv/inbox/' } })
    expect(explicit.statusCode).toBe(200)
    expect(explicit.json()).toEqual({ path: '/srv/inbox/report.txt', targetAgentId: target.id, size: 5 })
    expect(targetFs.files.get('/srv/inbox/report.txt')).toBe(Buffer.from('hello').toString('base64'))
    expect(targetFs.directories.has('/srv/inbox/')).toBe(true)
    // без targetDir — в incoming хранилища цели
    const storage = (await inj({ method: 'POST', url: `/api/agents/${target.id}/storages`, payload: { rootPath: '/root/ChatAI' } })).json()
    expect(storage.rootPath).toBe('/root/ChatAI')
    const auto = await inj({ method: 'POST', url: `/api/agents/${source.id}/fs/copy-to`, payload: { path: '/Users/me/report.txt', targetAgentId: target.id } })
    expect(auto.statusCode).toBe(200)
    expect(auto.json().path).toBe('/root/ChatAI/incoming/report.txt')
    // та же машина и офлайн-цель отклоняются
    expect((await inj({ method: 'POST', url: `/api/agents/${source.id}/fs/copy-to`, payload: { path: '/Users/me/report.txt', targetAgentId: source.id } })).statusCode).toBe(400)
    const offline = db.createAgent(U, 'Спит')
    expect((await inj({ method: 'POST', url: `/api/agents/${source.id}/fs/copy-to`, payload: { path: '/Users/me/report.txt', targetAgentId: offline.id } })).statusCode).toBe(409)
  })

  it('GET storage отдаёт карточке чата абсолютные каталоги и статус хранилища', async () => {
    const machine = db.createAgent(U, 'Мак')
    connectFs(machine.id)
    const storage = (await inj({ method: 'POST', url: `/api/agents/${machine.id}/storages`, payload: { rootPath: '/Users/me/ChatAI' } })).json()
    const conv = db.createConversation(U, 'C')
    expect((await inj({ method: 'GET', url: `/api/conversations/${conv.id}/storage` })).statusCode).toBe(404)
    await inj({ method: 'PUT', url: `/api/conversations/${conv.id}/storage`, payload: { machineId: machine.id, storageId: storage.id } })
    const view = (await inj({ method: 'GET', url: `/api/conversations/${conv.id}/storage` })).json()
    expect(view).toMatchObject({ machineId: machine.id, storageId: storage.id, rootPath: '/Users/me/ChatAI', status: 'ready' })
    expect(view.directories).toEqual({
      chatRoot: `/Users/me/ChatAI/chats/${conv.id}`,
      attachments: `/Users/me/ChatAI/chats/${conv.id}/attachments`,
      artifacts: `/Users/me/ChatAI/chats/${conv.id}/artifacts`,
      generated: `/Users/me/ChatAI/chats/${conv.id}/.generated`
    })
  })
})

describe('REST: журнал команд машины', () => {
  it('exec через REST попадает в журнал; фильтр по подстроке и CSV-экспорт', async () => {
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const socket = {
      close: vi.fn(),
      send(data: string) {
        const message = JSON.parse(data) as { t: string; execId?: string; command?: string }
        if (message.t === 'exec.start') {
          agentRegistry.handleMessage(created.id, { t: 'exec.chunk', execId: message.execId!, stream: 'stdout', data: `ran ${message.command}` })
          agentRegistry.handleMessage(created.id, { t: 'exec.done', execId: message.execId!, exitCode: message.command === 'false' ? 1 : 0 })
        }
      }
    }
    agentRegistry.register(created.id, 'M', socket, db.listAgents(U).find((a) => a.id === created.id)!.policy, '0.15.0')
    expect((await inj({ method: 'POST', url: `/api/agents/${created.id}/exec`, payload: { command: 'uptime' } })).statusCode).toBe(200)
    expect((await inj({ method: 'POST', url: `/api/agents/${created.id}/exec`, payload: { command: 'false' } })).statusCode).toBe(200)
    const all = (await inj({ method: 'GET', url: `/api/agents/${created.id}/commands` })).json()
    expect(all.map((r: { command: string }) => r.command)).toEqual(['false', 'uptime'])
    expect(all[1]).toMatchObject({ source: 'console', userId: U, exitCode: 0, outputExcerpt: 'ran uptime', conversationId: null })
    expect(all[0].exitCode).toBe(1)
    const filtered = (await inj({ method: 'GET', url: `/api/agents/${created.id}/commands?q=upt&source=console` })).json()
    expect(filtered).toHaveLength(1)
    const csv = await inj({ method: 'GET', url: `/api/agents/${created.id}/commands?format=csv` })
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.body.split('\n')[0]).toBe('startedAt,user,source,command,exitCode,timedOut,durationMs,conversationId,error')
    expect(csv.body).toContain('"uptime","0"')
    // чужая машина — 404
    db.createUser('user2', '', 'developer')
    const other = db.createAgent('user2', 'X')
    expect((await inj({ method: 'GET', url: `/api/agents/${other.id}/commands` })).statusCode).toBe(404)
  })
})

describe('REST: доступ участников к машине проекта (п.18)', () => {
  it('доступ «только чтение»: fs-чтение работает, запись/команды/группа — 403; полный доступ возвращает права', async () => {
    const machine = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'Общая' } })).json()
    const socket = { close: vi.fn(), send(data: string) {
      const m = JSON.parse(data) as { t: string; opId?: string; execId?: string; path?: string }
      if (m.t === 'exec.start') agentRegistry.handleMessage(machine.id, { t: 'exec.done', execId: m.execId!, exitCode: 0 })
      else if (m.opId) agentRegistry.handleMessage(machine.id, { t: 'fs.result', opId: m.opId, result: { root: '/', cwd: m.path ?? '/', entries: [] } })
    } }
    agentRegistry.register(machine.id, 'Общая', socket, db.listAgents(U).find((a) => a.id === machine.id)!.policy, '0.15.0')
    const project = db.createProject(U, { name: 'Shared' })
    db.createUser('dev2', '', 'developer')
    db.addMember(U, project.id, 'dev2')
    const devToken = signToken({ name: 'dev2', role: 'developer' }, SECRET)
    const asDev = (opts: InjOpts) => app.inject({ ...opts, headers: { authorization: `Bearer ${devToken}`, ...(opts.headers ?? {}) } })

    // владелец делится машиной в режиме «только чтение»
    const shared = await inj({ method: 'PUT', url: `/api/projects/${project.id}/machines/${machine.id}/share`, payload: { shared: true, access: 'read' } })
    expect(shared.statusCode).toBe(200)
    expect(shared.json().machines.find((m: { agentId: string }) => m.agentId === machine.id).shareAccess).toBe('read')

    const q = `?projectId=${project.id}`
    expect((await asDev({ method: 'GET', url: `/api/agents/${machine.id}/fs${q}&path=/srv` })).statusCode).toBe(200)
    const write = await asDev({ method: 'POST', url: `/api/agents/${machine.id}/fs/file${q}`, payload: { path: '/srv/x', dataBase64: '' } })
    expect(write.statusCode).toBe(403)
    expect(write.json().error).toContain('только для чтения')
    expect((await asDev({ method: 'POST', url: `/api/agents/${machine.id}/fs/mkdir${q}`, payload: { path: '/srv/y' } })).statusCode).toBe(403)
    expect((await asDev({ method: 'POST', url: `/api/agents/${machine.id}/exec${q}`, payload: { command: 'ls' } })).statusCode).toBe(403)
    const batch = await asDev({ method: 'POST', url: `/api/agents/exec-batch${q}`, payload: { machineIds: [machine.id], command: 'ls' } })
    expect(batch.json().totals).toMatchObject({ ok: 0, skipped: 1 })
    expect(batch.json().items[0].error).toContain('Только чтение')
    // машины в контексте чата помечены ownership/access
    const conv = db.createConversation('dev2', 'C')
    db.setConversationProject('dev2', conv.id, project.id)
    const listed = (await asDev({ method: 'GET', url: `/api/conversations/${conv.id}/machines${q}` })).json()
    expect(listed.find((m: { id: string }) => m.id === machine.id)).toMatchObject({ ownership: 'project', access: 'read' })

    // владелец поднимает доступ до полного — команды снова разрешены
    expect((await inj({ method: 'PUT', url: `/api/projects/${project.id}/machines/${machine.id}/share`, payload: { shared: true, access: 'full' } })).statusCode).toBe(200)
    expect((await asDev({ method: 'POST', url: `/api/agents/${machine.id}/exec${q}`, payload: { command: 'ls' } })).statusCode).toBe(200)
    // владельцу его собственная машина всегда доступна полностью
    expect((await inj({ method: 'GET', url: '/api/agents' })).json().find((m: { id: string }) => m.id === machine.id)).toMatchObject({ ownership: 'personal', access: 'owner' })
    // некорректный уровень отклоняется
    expect((await inj({ method: 'PUT', url: `/api/projects/${project.id}/machines/${machine.id}/share`, payload: { shared: true, access: 'bogus' } })).statusCode).toBe(400)
  })
})

describe('REST: групповая команда (п.15)', () => {
  it('выполняет команду на нескольких машинах, сводка различает ok/failed/skipped; политика отклоняет весь запуск', async () => {
    const one = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M1' } })).json()
    const two = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M2' } })).json()
    const offline = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'Спит' } })).json()
    const connect = (id: string, exitCode: number) => {
      const socket = { close: vi.fn(), send(data: string) { const m = JSON.parse(data) as { t: string; execId?: string }; if (m.t === 'exec.start') { agentRegistry.handleMessage(id, { t: 'exec.chunk', execId: m.execId!, stream: 'stdout', data: `из ${id}` }); agentRegistry.handleMessage(id, { t: 'exec.done', execId: m.execId!, exitCode }) } } }
      agentRegistry.register(id, 'M', socket, db.listAgents(U).find((a) => a.id === id)!.policy, '0.15.0')
    }
    connect(one.id, 0)
    connect(two.id, 3)
    db.createUser('user4', '', 'developer')
    const foreign = db.createAgent('user4', 'Чужая')
    const res = await inj({ method: 'POST', url: '/api/agents/exec-batch', payload: { machineIds: [one.id, two.id, offline.id, foreign.id, one.id], command: 'uptime' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.totals).toEqual({ requested: 4, ok: 1, failed: 1, skipped: 2 })
    const byId = Object.fromEntries(body.items.map((i: { machineId: string }) => [i.machineId, i]))
    expect(byId[one.id]).toMatchObject({ ran: true, exitCode: 0, output: `из ${one.id}` })
    expect(byId[two.id]).toMatchObject({ ran: true, exitCode: 3 })
    expect(byId[offline.id]).toMatchObject({ ran: false })
    expect(byId[offline.id].error).toContain('не в сети')
    expect(byId[foreign.id]).toMatchObject({ ran: false, error: 'Машина недоступна' })
    // журнал команд получил обе выполненные команды
    expect(db.listMachineCommands(one.id).map((r) => r.command)).toEqual(['uptime'])
    // пустое тело и политика
    expect((await inj({ method: 'POST', url: '/api/agents/exec-batch', payload: { machineIds: [], command: 'ls' } })).statusCode).toBe(400)
    const project = db.createProject(U, { name: 'PB' })
    await inj({ method: 'PATCH', url: `/api/projects/${project.id}`, payload: { commandPolicy: { denyPatterns: ['uptime'], allowPatterns: [], confirmDangerous: true } } })
    const denied = await inj({ method: 'POST', url: `/api/agents/exec-batch?projectId=${project.id}`, payload: { machineIds: [one.id], command: 'uptime' } })
    expect(denied.statusCode).toBe(403)
  })
})

describe('REST: политика команд проекта и роли (п.10)', () => {
  it('deny проекта отклоняет команду консоли с 403 до exec; PATCH проекта и PUT ролей сохраняют правила', async () => {
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const socket = { close: vi.fn(), send(data: string) { const m = JSON.parse(data) as { t: string; execId?: string }; if (m.t === 'exec.start') agentRegistry.handleMessage(created.id, { t: 'exec.done', execId: m.execId!, exitCode: 0 }) } }
    agentRegistry.register(created.id, 'M', socket, db.listAgents(U).find((a) => a.id === created.id)!.policy, '0.15.0')
    const project = db.createProject(U, { name: 'P' })
    const patched = await inj({ method: 'PATCH', url: `/api/projects/${project.id}`, payload: { commandPolicy: { denyPatterns: ['docker'], allowPatterns: [], confirmDangerous: true } } })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().commandPolicy).toEqual({ denyPatterns: ['docker'], allowPatterns: [], confirmDangerous: true })
    const denied = await inj({ method: 'POST', url: `/api/agents/${created.id}/exec?projectId=${project.id}`, payload: { command: 'docker ps' } })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error).toContain('политикой проекта')
    expect((await inj({ method: 'POST', url: `/api/agents/${created.id}/exec?projectId=${project.id}`, payload: { command: 'ls' } })).statusCode).toBe(200)
    const put = await inj({ method: 'PUT', url: '/api/admin/command-policy', payload: { roles: { tester: { denyPatterns: ['git push'], allowPatterns: [] }, junk: { denyPatterns: ['x'] } } } })
    expect(put.json()).toEqual({ roles: { tester: { denyPatterns: ['git push'], allowPatterns: [] } } })
    expect((await inj({ method: 'GET', url: '/api/admin/command-policy' })).json().roles.tester.denyPatterns).toEqual(['git push'])
  })
})

describe('REST: токены агентов (срок, отзыв, привязка к IP)', () => {
  it('перевыпуск с ttlDays задаёт срок, отзыв закрывает вход, события попадают в журнал безопасности', async () => {
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const rotated = (await inj({ method: 'POST', url: `/api/agents/${created.id}/token`, payload: { ttlDays: 30 } })).json()
    expect(rotated.expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60_000)
    const listed = (await inj({ method: 'GET', url: '/api/agents' })).json()
    expect(listed[0].tokenExpiresAt).toBe(rotated.expiresAt)
    expect(db.findAgentByTokenHash(hashAgentToken(rotated.token))?.id).toBe(created.id)
    expect((await inj({ method: 'DELETE', url: `/api/agents/${created.id}/token` })).json()).toEqual({ ok: true })
    expect(db.findAgentByTokenHash(hashAgentToken(rotated.token))).toBeNull()
    expect((await inj({ method: 'POST', url: `/api/agents/${created.id}/pin-ip`, payload: { pin: true } })).statusCode).toBe(200)
    expect((await inj({ method: 'GET', url: '/api/agents' })).json()[0].pinIp).toBe(true)
    const events = (await inj({ method: 'GET', url: '/api/admin/security' })).json().events.map((e: { type: string }) => e.type)
    expect(events).toEqual(expect.arrayContaining(['agent_token_rotated', 'agent_token_revoked']))
    db.createUser('user3', '', 'developer')
    const other = db.createAgent('user3', 'X')
    expect((await inj({ method: 'DELETE', url: `/api/agents/${other.id}/token` })).statusCode).toBe(404)
    expect((await inj({ method: 'POST', url: `/api/admin/machines/${other.id}/token/revoke` })).json()).toEqual({ ok: true })
  })
})

describe('REST: метрики машин для админки', () => {
  it('stats и Prometheus-метрики агрегируют журнал команд и статус реестра', async () => {
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const socket = { close: vi.fn(), send(data: string) { const m = JSON.parse(data) as { t: string; execId?: string }; if (m.t === 'exec.start') agentRegistry.handleMessage(created.id, { t: 'exec.done', execId: m.execId!, exitCode: 1 }) } }
    agentRegistry.register(created.id, 'M', socket, db.listAgents(U).find((a) => a.id === created.id)!.policy, '0.15.0')
    await inj({ method: 'POST', url: `/api/agents/${created.id}/exec`, payload: { command: 'false' } })
    const stats = (await inj({ method: 'GET', url: '/api/admin/machines/stats' })).json()
    expect(stats.totals).toEqual({ machines: 1, online: 1, commands24h: 1, errors24h: 1 })
    expect(stats.machines[0]).toMatchObject({ id: created.id, owner: U, online: true, version: '0.15.0', commandsTotal: 1, errors24h: 1 })
    const metrics = await inj({ method: 'GET', url: '/api/admin/machines/metrics' })
    expect(metrics.headers['content-type']).toContain('text/plain')
    expect(metrics.body).toContain(`voicechat_machine_command_errors_24h{machine="M",machine_id="${created.id}",owner="${U}"} 1`)
  })
})

describe('REST: утилиты машины (exec/fs)', () => {
  it('exec: 404 на чужую машину; 400 на офлайн-машину владельца', async () => {
    // Своя офлайн-машина: exec → 400 (не в сети).
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const own = await inj({
      method: 'POST',
      url: `/api/agents/${created.id}/exec`,
      payload: { command: 'ls' }
    })
    expect(own.statusCode).toBe(400)
    expect(own.json().error).toContain('не в сети')

    // Чужая машина (создана под user) → 404 для admin.
    db.createUser('user', '', 'developer')
    const other = db.createAgent('user', 'UserBox')
    const foreign = await inj({
      method: 'POST',
      url: `/api/agents/${other.id}/exec`,
      payload: { command: 'ls' }
    })
    expect(foreign.statusCode).toBe(404)
  })

  it('fs.list: 400 на офлайн-машину владельца', async () => {
    const created = (await inj({ method: 'POST', url: '/api/agents', payload: { name: 'M' } })).json()
    const res = await inj({ method: 'GET', url: `/api/agents/${created.id}/fs?path=` })
    expect(res.statusCode).toBe(400)
  })

  it('GET /api/agents/version публичен и отдаёт версию', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents/version' }) // без токена
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ version: '0.15.0' })
  })
})
