// «Исследовать проект»: разбор ответа модели и запись статей в раздел проекта.
// Реальный CLI не запускается — клиент модели мокается (как в CI-хуках).

import { describe, it, expect, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import type { LlmClient, LlmRequest } from '../claude/types.js'
import { KbResearchManager, parseResearchOutput, researchPrompt, researchTarget } from './research.js'

function fakeClient(reply: string | { error: string }): { client: LlmClient; last: () => LlmRequest | null } {
  let last: LlmRequest | null = null
  return {
    client: {
      send(req, handlers) {
        last = req
        if (typeof reply === 'object') void handlers.onError(reply.error)
        else void handlers.onDone(reply)
        return { cancel: () => {} }
      }
    },
    last: () => last
  }
}

async function memoryDb(): Promise<VoiceChatDb> {
  let id = 0
  let clock = 1000
  const db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  await db.identity.ensureAdmin('x')
  return db
}

function makeManager(db: VoiceChatDb, reply: string | { error: string }): { manager: KbResearchManager; last: () => LlmRequest | null } {
  const { client, last } = fakeClient(reply)
  return {
    manager: new KbResearchManager({
      db,
      claude: client,
      codex: client,
      mcpBaseUrl: 'http://127.0.0.1:1/mcp/remote-bash?k=secret',
      agentNameOf: () => 'Ноутбук'
    }),
    last
  }
}

async function setup(reply: string | { error: string }): Promise<{ db: VoiceChatDb; manager: KbResearchManager; last: () => LlmRequest | null }> {
  const db = await memoryDb()
  return { db: await db, ...makeManager(db, reply) }
}

/** Проект с привязанной машиной и рабочей папкой — иначе исследовать нечего. */
async function projectWithMachine(db: VoiceChatDb): Promise<string> {
  const project = await db.projects.createProject('admin', { name: 'Магазин' })
  const agent = await db.machines.createAgent('admin', 'Ноутбук')
  await db.machines.linkMachine('admin', project.id, agent.id)
  await db.machines.setProjectMachinePath('admin', project.id, agent.id, '/srv/shop')
  return project.id
}

describe('parseResearchOutput', () => {
  it('снимает ```json-обёртку и отбрасывает записи без заголовка или тела', () => {
    const parsed = parseResearchOutput('```json\n{"note":"обновил обзор","documents":[{"title":"Обзор","body":"# Обзор"},{"title":"","body":"x"},{"title":"Пусто"}]}\n```')
    expect(parsed.note).toBe('обновил обзор')
    expect(parsed.documents.map((d) => d.title)).toEqual(['Обзор'])
  })
  it('выхватывает JSON из текста вокруг и нормализует kind', () => {
    const parsed = parseResearchOutput('Готово: {"documents":[{"title":"API","kind":"выдумка","body":"# API"}]}')
    expect(parsed.documents[0].kind).toBe('subsystem')
  })
  it('неразборчивый ответ — ошибка', () => {
    expect(() => parseResearchOutput('совсем не json')).toThrow()
  })
})

describe('researchPrompt / researchTarget', () => {
  it('в промпте есть каталог проекта и id существующих статей', async () => {
    const { db } = await setup('{}')
    const id = await projectWithMachine(db)
    const project = (await db.projects.getProject('admin', id))!
    const existing = (await db.kb.kbDocuments({ scope: 'project', projectId: id })).map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt }))
    const prompt = researchPrompt(project, '/srv/shop', existing)
    expect(prompt).toContain('/srv/shop')
    expect(prompt).toContain(existing[0].id)
    expect(researchTarget(project)).toEqual({ agentId: project.machines[0].agentId, workdir: '/srv/shop' })
  })
  it('без машины исследовать негде', async () => {
    const { db } = await setup('{}')
    const project = await db.projects.createProject('admin', { name: 'Без машины' })
    expect(researchTarget((await db.projects.getProject('admin', project.id))!)).toBeNull()
  })
})

describe('KbResearchManager', () => {
  it('обновляет существующую статью и заводит новую, оставаясь в разделе проекта', async () => {
    const db = await memoryDb()
    const projectId = await projectWithMachine(db)
    const skeleton = (await db.kb.kbDocuments({ scope: 'project', projectId }))[0]
    const reply = JSON.stringify({
      note: 'сверил с кодом',
      documents: [
        { id: skeleton.id, title: 'Разработка: Магазин', body: '# Разработка: Магазин\n\nМонорепо на pnpm.', areas: ['apps/api'] },
        { title: 'Оплата', kind: 'feature', body: '# Оплата\n\nЧерез провайдера.' }
      ]
    })
    const { manager } = makeManager(db, reply)
    const run = manager.start('admin', (await db.projects.getProject('admin', projectId))!)
    expect(run.state).toBe('running')
    await vi.waitFor(() => expect(manager.get(projectId)?.state).toBe('done'))

    const done = manager.get(projectId)!
    expect(done.note).toBe('сверил с кодом')
    expect(done.documents).toEqual([
      { id: skeleton.id, title: 'Разработка: Магазин', action: 'updated' },
      { id: expect.any(String), title: 'Оплата', action: 'created' }
    ])
    const docs = await db.kb.kbDocuments({ scope: 'project', projectId })
    expect(docs).toHaveLength(2)
    expect(docs.every((doc) => doc.scope === 'project' && doc.projectId === projectId)).toBe(true)
    expect(docs.find((doc) => doc.id === skeleton.id)?.body).toContain('Монорепо на pnpm')
  })

  it('проброшен remote-bash машины проекта в режиме чтения', async () => {
    const { db, manager, last } = await setup('{"documents":[]}')
    const projectId = await projectWithMachine(db)
    manager.start('admin', (await db.projects.getProject('admin', projectId))!)
    await vi.waitFor(() => expect(manager.get(projectId)?.state).toBe('done'))
    const req = last()!
    expect(req.readOnlyRemote).toBe(true)
    expect(req.remote?.mcpUrl).toContain('cwd=%2Fsrv%2Fshop')
    expect(req.sessionId).toBeNull()
  })

  it('ошибка модели попадает в состояние прогона, а база не меняется', async () => {
    const { db, manager } = await setup({ error: 'CLI не найден' })
    const projectId = await projectWithMachine(db)
    manager.start('admin', (await db.projects.getProject('admin', projectId))!)
    await vi.waitFor(() => expect(manager.get(projectId)?.state).toBe('error'))
    expect(manager.get(projectId)?.error).toBe('CLI не найден')
    expect(await db.kb.kbDocuments({ scope: 'project', projectId: await projectId })).toHaveLength(1)
  })

  it('второй запуск во время прогона не плодит параллельные CLI', async () => {
    const { db } = await setup('{"documents":[]}')
    const projectId = await projectWithMachine(db)
    let started = 0
    const client: LlmClient = { send: () => { started += 1; return { cancel: () => {} } } }
    const busy = new KbResearchManager({ db, claude: client, codex: client, mcpBaseUrl: 'http://x?k=1', agentNameOf: () => 'M' })
    const project = (await db.projects.getProject('admin', projectId))!
    const first = busy.start('admin', project)
    const second = busy.start('admin', project)
    expect(second).toBe(first)
    // Спавн CLI идёт после чтения БД — дожидаемся макротика, прежде чем считать запуски.
    await new Promise((resolve) => setImmediate(resolve))
    expect(started).toBe(1)
  })
})

describe('режим «по изменениям с коммита»', () => {
  it('переиспользует промпт шага CI-рана: сравнение с sha, файлы не правим', async () => {
    const db = await memoryDb()
    const projectId = await projectWithMachine(db)
    const { manager, last } = makeManager(db, '{"note":"мелочь","nothingToUpdate":true,"documents":[]}')
    const run = manager.start('admin', (await db.projects.getProject('admin', projectId))!, { sinceSha: 'abc1234' })
    expect(run.sinceSha).toBe('abc1234')
    await vi.waitFor(() => expect(manager.get(projectId)?.state).toBe('done'))
    const prompt = last()!.prompt
    expect(prompt).toContain('git diff --stat abc1234')
    expect(prompt).toContain('Файлы репозитория не меняй')
    // Заготовка обзорной статьи проекта попадает в список задетых.
    expect(prompt).toContain((await db.kb.kbDocuments({ scope: 'project', projectId }))[0].id)
  })

  it('мусор вместо sha отбивается до запуска модели', async () => {
    const db = await memoryDb()
    const projectId = await projectWithMachine(db)
    const { manager } = makeManager(db, '{}')
    await expect(async () => manager.start('admin', (await db.projects.getProject('admin', projectId))!, { sinceSha: 'abc; rm -rf /' })).rejects.toThrow()
  })

  it('полный скан остаётся режимом по умолчанию', async () => {
    const db = await memoryDb()
    const projectId = await projectWithMachine(db)
    const { manager, last } = makeManager(db, '{"documents":[]}')
    expect(manager.start('admin', (await db.projects.getProject('admin', projectId))!).sinceSha).toBeNull()
    await vi.waitFor(() => expect(manager.get(projectId)?.state).toBe('done'))
    expect(last()!.prompt).toContain('просканировать репозиторий')
  })
})
