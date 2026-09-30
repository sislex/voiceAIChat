// Файлы сервера, задачи из предложений, машины настроек разговора и preview-прокси.
import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { VoiceChatDb } from '../db/database.js'
import { setupRestHarness } from './restHarness.js'

// Обвязка одна на все rest.*.test.ts — см. restHarness.ts.
// Хук harness зарегистрирован первым, поэтому к моменту этого beforeEach
// поля уже пересозданы под текущий тест.
const harness = setupRestHarness()
const { inj, U } = harness
let app: FastifyInstance
let db: VoiceChatDb
let dataDir: string
beforeEach(() => { ({ app, db, dataDir } = harness) })


describe('REST: чтение файла с диска сервера (/api/files/read)', () => {
  // Preserve access to existing generated files without creating a CLI profile.
  async function seedImage(): Promise<string> {
    const dir = join(dataDir, 'cli-users', Buffer.from(U).toString('base64url'), '.codex', 'generated_images', 'sess')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'pic.png')
    writeFileSync(file, 'PNGDATA')
    return file
  }

  it('отдаёт картинку из профиля пользователя', async () => {
    const file = await seedImage()
    const res = await inj({ method: 'GET', url: `/api/files/read?path=${encodeURIComponent(file)}` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { name: string; dataBase64: string }
    expect(body.name).toBe('pic.png')
    expect(Buffer.from(body.dataBase64, 'base64').toString()).toBe('PNGDATA')
  })

  it('файл вне своей области — 404', async () => {
    await seedImage()
    const outside = join(tmpdir(), `vc-outside-${Date.now()}.png`)
    writeFileSync(outside, 'NOPE')
    const res = await inj({ method: 'GET', url: `/api/files/read?path=${encodeURIComponent(outside)}` })
    expect(res.statusCode).toBe(404)
    rmSync(outside, { force: true })
  })

  it('без токена — 401 (роут под общей защитой /api)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/files/read?path=/etc/passwd' })
    expect(res.statusCode).toBe(401)
  })

  it('системный файл не отдаётся', async () => {
    const res = await inj({ method: 'GET', url: '/api/files/read?path=/etc/passwd' })
    expect(res.statusCode).toBe(404)
  })
})

describe('REST: машины настроек разговора', () => {
  it('обычный чат видит только личные машины, проектный — личные и проектные без дублей', async () => {
    await db.identity.createUser('owner', '', 'developer')
    await db.identity.createUser('outsider', '', 'developer')
    const own = await db.machines.createAgent(U, 'Личная')
    const shared = await db.machines.createAgent('owner', 'Проектная')
    const hidden = await db.machines.createAgent('outsider', 'Чужая')
    const project = await db.projects.createProject('owner', { name: 'Shared' })
    await db.machines.linkMachine('owner', project.id, shared.id)
    await db.projects.addMember('owner', project.id, U)
    const plain = await db.chat.createConversation(U, 'Обычный')

    const plainMachines = (await inj({ method: 'GET', url: `/api/conversations/${plain.id}/machines` })).json()
    expect(plainMachines.map((a: { id: string }) => a.id)).toEqual([own.id])

    const projectMachines = (await inj({ method: 'GET', url: `/api/conversations/${plain.id}/machines?projectId=${project.id}` })).json()
    expect(projectMachines.map((a: { id: string }) => a.id).sort()).toEqual([own.id, shared.id].sort())
    expect(projectMachines.filter((a: { id: string }) => a.id === own.id)).toHaveLength(1)
    expect(projectMachines.some((a: { id: string }) => a.id === hidden.id)).toBe(false)
  })

  it('не даёт неучастнику увидеть проектную машину или сохранить недоступную', async () => {
    await db.identity.createUser('owner', '', 'developer')
    const foreign = await db.machines.createAgent('owner', 'Серверная')
    const project = await db.projects.createProject('owner', { name: 'Private' })
    await db.machines.linkMachine('owner', project.id, foreign.id)
    const conversation = await db.chat.createConversation(U, 'Чат')

    const list = (await inj({ method: 'GET', url: `/api/conversations/${conversation.id}/machines?projectId=${project.id}` })).json()
    expect(list.some((a: { id: string }) => a.id === foreign.id)).toBe(false)

    const denied = await inj({
      method: 'PATCH',
      url: `/api/conversations/${conversation.id}`,
      payload: { execTarget: foreign.id }
    })
    expect(denied.statusCode).toBe(403)
    expect((await db.chat.getConversation(U, conversation.id))?.execTarget).toBeNull()
  })
})

it('boots without a runner and never creates CLI profiles for management requests', async () => {
  const status = await inj({ method: 'GET', url: '/api/auth/status' })
  expect(status.statusCode).toBe(200)
  expect(status.json()).toMatchObject({ claude: { loggedIn: false }, codex: { loggedIn: false } })
  for (const url of ['/api/mcp/servers', '/api/cc/projects', '/api/cx/projects']) {
    const response = await inj({ method: 'GET', url })
    expect(response.statusCode).toBe(503)
    expect(response.json().error).toBe('runner_not_configured')
  }
  expect(existsSync(join(dataDir, 'cli-users'))).toBe(false)
})
