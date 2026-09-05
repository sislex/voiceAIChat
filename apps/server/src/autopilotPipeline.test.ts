// Начало конвейера у автопрохода. Координатор раньше подхватывал задачу только
// с `component_qa`: старт подготовки и переход ready → development жили в
// drag&drop-роуте доски, поэтому карточка с включённым автопроходом стояла в
// TODO, пока человек не перетащит её руками. Здесь зафиксировано, что она
// уезжает сама и что сломанное окружение не превращается в бесконечный цикл.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'
import { loadConfig } from './config.js'
import { VoiceChatDb } from './db/database.js'
import { signToken } from './users/accounts.js'
import type { Board, LlmClient, LlmHandle, LlmRequest, ProjectDetail, Task, TaskPreparationRun } from '@voicechat/shared'

const SECRET = 'test-secret'

let db: VoiceChatDb
let app: FastifyInstance
let adminTok: string
/** Что ответит модель подготовки: ошибка, текст или «висит» (ран остаётся running). */
let answer: () => { text: string } | { error: string } | { hang: true }

/** CLI не запускается: координатору достаточно факта запущенной попытки. */
function fakeCli(): LlmClient {
  return {
    send(_req: LlmRequest, handlers): LlmHandle {
      const reply = answer()
      if ('hang' in reply) return { cancel: () => {} }
      const timer = setTimeout(() => {
        if ('error' in reply) handlers.onError(reply.error)
        else { handlers.onDelta(reply.text); handlers.onDone(reply.text) }
      }, 0)
      return { cancel: () => clearTimeout(timer) }
    }
  }
}

function inj(opts: { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object }) {
  return app.inject({ ...opts, headers: { authorization: `Bearer ${adminTok}` } })
}

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  answer = () => ({ error: 'CLI недоступен' })
  app = await buildServer({
    config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-autopilot-${Date.now()}-${id}`) }),
    db,
    sessionSecret: SECRET,
    claude: fakeCli(),
    codex: fakeCli()
  })
  adminTok = signToken({ name: 'admin', role: 'admin' }, SECRET)
})

afterEach(async () => {
  await app.close()
  db.close()
})

/** Проект с системным workflow и задача в TODO. */
async function taskInBacklog(): Promise<{ projectId: string; taskId: string; columns: Board['columns'] }> {
  const project = (await inj({ method: 'POST', url: '/api/projects', payload: { name: 'P' } })).json() as ProjectDetail
  const board = (await inj({ method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
  const backlog = board.columns.find((column) => column.semanticType === 'backlog')!
  const task = (await inj({
    method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: backlog.id, title: 'Задача' }
  })).json() as Task
  return { projectId: project.id, taskId: task.id, columns: board.columns }
}

const enableAutoPilot = (projectId: string, taskId: string) =>
  inj({ method: 'PATCH', url: `/api/projects/${projectId}/tasks/${taskId}`, payload: { autoPilot: true } })

async function runs(projectId: string, taskId: string): Promise<TaskPreparationRun[]> {
  const res = await inj({ method: 'GET', url: `/api/projects/${projectId}/tasks/${taskId}/preparation/runs` })
  return res.json() as TaskPreparationRun[]
}

/** Координатор работает на микротасках board-события, поэтому ждём условие. */
async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean, limit = 200): Promise<T> {
  for (let i = 0; i < limit; i++) {
    const value = await read()
    if (ok(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('условие не выполнилось')
}

async function semanticOf(projectId: string, taskId: string): Promise<string> {
  const board = (await inj({ method: 'GET', url: `/api/projects/${projectId}/board` })).json() as Board
  const task = board.tasks.find((item) => item.id === taskId)!
  return board.columns.find((column) => column.id === task.columnId)!.semanticType
}

describe('автопроход у новых задач', () => {
  it('наследуется от настройки проекта и только задачами', async () => {
    const project = (await inj({ method: 'POST', url: '/api/projects', payload: { name: 'P' } })).json() as ProjectDetail
    await inj({ method: 'PATCH', url: `/api/projects/${project.id}`, payload: { autoPilotDefault: true } })
    const board = (await inj({ method: 'GET', url: `/api/projects/${project.id}/board` })).json() as Board
    const backlog = board.columns.find((column) => column.semanticType === 'backlog')!

    const task = (await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: backlog.id, title: 'Задача' } })).json() as Task
    // Эпик и история этапы конвейера не проходят, флаг им не нужен.
    const epic = (await inj({ method: 'POST', url: `/api/projects/${project.id}/tasks`, payload: { columnId: backlog.id, title: 'Эпик', type: 'epic' } })).json() as Task
    expect(task.autoPilot).toBe(true)
    expect(epic.autoPilot).toBe(false)
  })

  it('выключенная настройка оставляет новые задачи без автопрохода', async () => {
    const { projectId, taskId } = await taskInBacklog()
    const task = (await inj({ method: 'GET', url: `/api/projects/${projectId}/tasks/${taskId}` })).json() as Task
    expect(task.autoPilot).toBe(false)
  })
})

describe('автопроход: начало конвейера', () => {
  it('включённый автопроход сам уводит задачу из TODO в подготовку и запускает попытку', async () => {
    const { projectId, taskId } = await taskInBacklog()
    // Попытка не завершается: проверяется сам факт автозапуска, а не её исход.
    answer = () => ({ hang: true })
    expect(await runs(projectId, taskId)).toHaveLength(0)

    await enableAutoPilot(projectId, taskId)

    const list = await eventually(() => runs(projectId, taskId), (value) => value.length > 0)
    expect(list.some((run) => run.attempt === 1)).toBe(true)
    expect(await semanticOf(projectId, taskId)).toBe('preparation')
  })

  it('без автопрохода карточка остаётся в TODO и подготовка не стартует', async () => {
    const { projectId, taskId } = await taskInBacklog()
    await inj({ method: 'PATCH', url: `/api/projects/${projectId}/tasks/${taskId}`, payload: { title: 'Другое имя' } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await runs(projectId, taskId)).toHaveLength(0)
    expect(await semanticOf(projectId, taskId)).toBe('backlog')
  })

  it('у Git-проекта с offline-машиной подготовка не стартует и попытки не жжёт', async () => {
    const { projectId, taskId } = await taskInBacklog()
    // Git-проекту нужна копия на машине: без online-машины запускать нечего, и
    // прежний перезапуск «на автомате» только сжигал круги за чужой сбой.
    const agent = db.createAgent('admin', 'Спящий ноутбук')
    db.linkMachine('admin', projectId, agent.id)
    db.setProjectMachinePath('admin', projectId, agent.id, '/srv/app')
    db.updateProject('admin', projectId, { gitUrl: 'git@github.com:x/y.git' })

    await enableAutoPilot(projectId, taskId)
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(await runs(projectId, taskId)).toHaveLength(0)
    expect(await semanticOf(projectId, taskId)).toBe('backlog')
  })

  it('упавшая попытка повторяется автоматически, а после лимита автопроход останавливается', async () => {
    const { projectId, taskId } = await taskInBacklog()
    // Лимит доработок общий для автопрохода: он же ограничивает повторы подготовки.
    await inj({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { autoPilotFixLimit: 2 } })
    await enableAutoPilot(projectId, taskId)

    const list = await eventually(
      () => runs(projectId, taskId),
      (value) => value.length >= 2 && value.every((run) => run.status === 'failed' || run.status === 'blocked')
    )
    expect(list.length).toBe(2)
    // Третьей попытки нет: лимит исчерпан, и карточка ждёт человека.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect((await runs(projectId, taskId)).length).toBe(2)
    expect(await semanticOf(projectId, taskId)).toBe('decision_required')
  })
})
