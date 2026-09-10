// Файлы сервера, задачи из предложений, машины настроек разговора и preview-прокси.
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  // Профиль CLI создаётся при первом обращении к нему; дёргаем любой роут,
  // который его трогает, а затем кладём туда «сгенерированную» картинку.
  async function seedImage(): Promise<string> {
    await inj({ method: 'GET', url: '/api/auth/status' })
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

describe('REST: задачи из предложений улучшений', () => {
  it('создаёт атомарно, возвращает идемпотентный результат и отклоняет повторный переход', async () => {
    const project = await db.projects.createProject(U, { name: 'P' })
    const column = (await db.tasks.getBoard(U, project.id))!.columns[0]!
    const source = (await db.tasks.createTask(U, project.id, { columnId: column.id, title: 'Source' }))!
    const improvement = await db.tasks.upsertTaskImprovement({
      projectId: project.id, taskId: source.id, runId: null, stepId: null, source: 'development',
      title: 'Улучшить ретраи', description: 'Подробности', fingerprint: 'rest-retry',
      evidence: ['Ошибка видима'], suggestedAction: 'create_chatai_task'
    })
    const payload = { columnId: column.id, title: 'Retry task', description: 'D', acceptanceCriteria: 'AC' }
    const first = await inj({ method: 'POST', url: `/api/improvements/${improvement.id}/create-task`, payload })
    const second = await inj({ method: 'POST', url: `/api/improvements/${improvement.id}/create-task`, payload })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ created: true, improvement: { status: 'implemented' } })
    expect(second.json()).toMatchObject({ created: false, task: { id: first.json().task.id } })
    const invalid = await inj({ method: 'PATCH', url: `/api/improvements/${improvement.id}`, payload: { status: 'accepted' } })
    expect(invalid.statusCode).toBe(409)
  })

  it('очередь проекта, создание одной кнопкой в backlog и удаление предложения', async () => {
    const project = await db.projects.createProject(U, { name: 'P' })
    const board = (await db.tasks.getBoard(U, project.id))!
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    const source = (await db.tasks.createTask(U, project.id, { columnId: backlog.id, title: 'Source' }))!
    const improvement = await db.tasks.upsertTaskImprovement({
      projectId: project.id, taskId: source.id, runId: null, stepId: null, source: 'development',
      title: 'Стабилизировать: npm test', description: 'Подробности', fingerprint: 'rest-queue',
      evidence: ['Статус шага: failed'], files: ['apps/server/src/turns.ts'], acceptanceCriteria: 'Шаг проходит.', suggestedAction: 'create_chatai_task'
    })
    const queue = await inj({ method: 'GET', url: `/api/projects/${project.id}/improvements` })
    expect(queue.statusCode).toBe(200)
    expect(queue.json()).toEqual([expect.objectContaining({ id: improvement.id, taskTitle: 'Source', taskColumnId: backlog.id, files: ['apps/server/src/turns.ts'] })])

    // Тело пустое: колонка — backlog проекта, текст — из предложения.
    const created = await inj({ method: 'POST', url: `/api/improvements/${improvement.id}/create-task`, payload: {} })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ created: true, preparationStarted: false, preparationError: null, task: { columnId: backlog.id, title: 'Стабилизировать: npm test', acceptanceCriteria: 'Шаг проходит.' } })
    expect((await inj({ method: 'GET', url: `/api/projects/${project.id}/improvements` })).json()).toEqual([])

    const badBody = await inj({ method: 'POST', url: `/api/improvements/${improvement.id}/create-task`, payload: { title: 42 } })
    expect(badBody.statusCode).toBe(400)

    const second = await db.tasks.upsertTaskImprovement({
      projectId: project.id, taskId: source.id, runId: null, stepId: null, source: 'development',
      title: 'Второе', description: 'D', fingerprint: 'rest-queue-2', evidence: [], suggestedAction: 'create_chatai_task'
    })
    const removed = await inj({ method: 'DELETE', url: `/api/improvements/${second.id}` })
    expect(removed.statusCode).toBe(200)
    expect(removed.json()).toEqual({ ok: true })
    expect((await inj({ method: 'DELETE', url: `/api/improvements/${second.id}` })).statusCode).toBe(404)
  })

  it('«создать и подготовить»: отказ подготовки не откатывает созданную задачу', async () => {
    const project = await db.projects.createProject(U, { name: 'P' })
    const board = (await db.tasks.getBoard(U, project.id))!
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
    // Пользователю закрыты оба провайдера: запуск подготовки детерминированно
    // отказывает ещё до обращения к CLI, а тест не порождает процессов.
    await db.identity.setUserLlmAccess(U, [{ provider: 'claude', modelId: '*' }, { provider: 'codex', modelId: '*' }])
    const source = (await db.tasks.createTask(U, project.id, { columnId: backlog.id, title: 'Source' }))!
    const improvement = await db.tasks.upsertTaskImprovement({
      projectId: project.id, taskId: source.id, runId: null, stepId: null, source: 'development',
      title: 'Третье', description: 'D', fingerprint: 'rest-prepare', evidence: [], suggestedAction: 'create_chatai_task'
    })
    const res = await inj({ method: 'POST', url: `/api/improvements/${improvement.id}/create-task`, payload: { startPreparation: true } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ created: true, preparationStarted: false, task: { columnId: backlog.id } })
    expect(String(body.preparationError)).toMatch(/недоступен/)
    expect((await db.tasks.getBoard(U, project.id))!.tasks.some((task) => task.id === body.task.id)).toBe(true)
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
