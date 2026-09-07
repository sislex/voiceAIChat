import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb

beforeEach(async () => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  await db.identity.createUser('alice', '', 'developer')
  await db.identity.createUser('bob', '', 'developer')
  await db.identity.createUser('carol', '', 'developer')
})

afterEach(() => db.close())

/** Проект с одной задачей и Make-чатом, привязанным к этому же проекту. */
async function scene(): Promise<{ projectId: string; taskId: string; makeId: string }> {
  const project = await db.projects.createProject('alice', { name: 'Piara' })
  await db.projects.addMember('alice', project.id, 'bob')
  const column = (await db.tasks.getBoard('alice', project.id))!.columns[0]
  const task = (await db.tasks.createTask('alice', project.id, { columnId: column.id, title: 'Экран оплаты' }))!
  const make = await db.chat.createConversation('alice', 'Проект 1', 'make')
  await db.chat.setConversationProject('alice', make.id, project.id)
  return { projectId: project.id, taskId: task.id, makeId: make.id }
}

describe('дизайны карточки', () => {
  it('связывает задачу со страницей Make-проекта и отдаёт имя проекта вместе со связью', async () => {
    const { projectId, taskId, makeId } = await scene()
    const links = await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'pay.html', label: 'Оплата' })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ conversationId: makeId, conversationTitle: 'Проект 1', conversationOwner: 'alice', path: 'pay.html', label: 'Оплата' })
    expect((await db.tasks.getTaskDetail('alice', projectId, taskId))!.designs).toHaveLength(1)
    // CI-ран получает те же связи: макет — часть постановки для модели.
    expect((await db.tasks.getCiTask('alice', projectId, taskId))!.designs).toHaveLength(1)
  })

  it('повторная связь той же страницы не плодит дублей, а только обновляет подпись', async () => {
    const { projectId, taskId, makeId } = await scene()
    await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'pay.html' })
    const links = await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'pay.html', label: 'Оплата' })
    expect(links).toHaveLength(1)
    expect(links[0].label).toBe('Оплата')
  })

  it('источником может быть только Make-проект этого же проекта', async () => {
    const { projectId, taskId } = await scene()
    const plain = await db.chat.createConversation('alice', 'Обычный чат')
    await db.chat.setConversationProject('alice', plain.id, projectId)
    await expect(async () => await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: plain.id })).rejects.toThrow('Make')

    const foreign = await db.chat.createConversation('alice', 'Чужой макет', 'make')
    await expect(async () => await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: foreign.id })).rejects.toThrow('не привязан')
  })

  it('путь страницы проверяется правилами Make, пустой путь означает проект целиком', async () => {
    const { projectId, taskId, makeId } = await scene()
    await expect(async () => await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: '../secrets' })).rejects.toThrow()
    expect((await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: '  ' }))[0].path).toBe('')
  })

  it('нормализует детерминированный набор, дедуплицирует и атомарно заменяет его', async () => {
    const { projectId, taskId, makeId } = await scene()
    let links = await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'files', paths: ['src/App.tsx', 'index.html', 'src/App.tsx'] })
    expect(links[0]).toMatchObject({ mode: 'files', paths: ['index.html', 'src/App.tsx'] })
    links = await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'whole_project', paths: [] })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ mode: 'whole_project', paths: [] })
    await expect(async () => await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'files', paths: [] })).rejects.toThrow('хотя бы один')
    await expect(async () => await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'whole_project', paths: ['index.html'] })).rejects.toThrow('несовместим')
    await expect(async () => await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'files', paths: ['/index.html'] })).rejects.toThrow('каноническим')
  })

  it('историческая чужая связь видна участнику, но новую связь с чужим Make-проектом создать нельзя', async () => {
    const { projectId, taskId, makeId } = await scene()
    await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'index.html' })
    expect(await db.tasks.listTaskDesigns('bob', projectId, taskId)).toHaveLength(1)
    expect((await db.tasks.getTaskDetail('bob', projectId, taskId))!.designs).toHaveLength(1)
    await expect(async () => await db.tasks.linkTaskDesign('bob', projectId, taskId, { conversationId: makeId })).rejects.toThrow('только свой')
    expect(await db.tasks.listTaskDesigns('carol', projectId, taskId)).toBeNull()
    await expect(async () => await db.tasks.linkTaskDesign('carol', projectId, taskId, { conversationId: makeId })).rejects.toThrow()
  })

  it('снятие связи убирает её у задачи', async () => {
    const { projectId, taskId, makeId } = await scene()
    const [link] = await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'index.html' })
    expect(await db.tasks.unlinkTaskDesign('alice', projectId, taskId, link.id)).toEqual([])
  })

  it('обратное направление: панель Make видит задачи своей страницы и умеет фильтровать по ней', async () => {
    const { projectId, taskId, makeId } = await scene()
    await db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'pay.html' })
    const column = (await db.tasks.getBoard('alice', projectId))!.columns[0]
    const other = (await db.tasks.createTask('alice', projectId, { columnId: column.id, title: 'Главная' }))!
    await db.tasks.linkTaskDesign('alice', projectId, other.id, { conversationId: makeId, path: 'index.html' })

    expect(await db.tasks.makeTaskLinks(makeId)).toHaveLength(2)
    const onPage = await db.tasks.makeTaskLinks(makeId, 'pay.html')
    expect(onPage).toHaveLength(1)
    expect(onPage[0]).toMatchObject({ taskId, taskKey: 'PIAR-1', taskTitle: 'Экран оплаты' })
  })

  it('панель Make предлагает карточки своего проекта только участнику', async () => {
    const { makeId } = await scene()
    expect((await db.tasks.makeLinkableTasks('bob', makeId)).map((t) => t.title)).toEqual(['Экран оплаты'])
    expect(await db.tasks.makeLinkableTasks('carol', makeId)).toEqual([])
  })

  it('источники дизайна проекта — все и только собственные Make-проекты участника', async () => {
    const { projectId, makeId } = await scene()
    const first = await db.chat.createConversation('bob', 'Bob 1', 'make')
    await db.chat.setConversationProject('bob', first.id, projectId)
    const second = await db.chat.createConversation('bob', 'Bob 2', 'make')
    await db.chat.setConversationProject('bob', second.id, projectId)
    const other = await db.chat.createConversation('alice', 'Alice 2', 'make')
    await db.chat.setConversationProject('alice', other.id, projectId)

    const sources = (await db.tasks.projectDesignSources('bob', projectId))!
    expect(sources.map((source) => source.conversationId)).toEqual([second.id, first.id])
    expect(sources).toMatchObject([
      { title: 'Bob 2', owner: 'bob', own: true },
      { title: 'Bob 1', owner: 'bob', own: true }
    ])
    expect(sources.map((source) => source.conversationId)).not.toContain(makeId)
    expect(sources.map((source) => source.conversationId)).not.toContain(other.id)
    expect(await db.tasks.projectDesignSources('carol', projectId)).toBeNull()
  })

  it('участник проекта читает привязанный к проекту Make-проект, посторонний — нет', async () => {
    const { makeId } = await scene()
    expect(await db.chat.isMakeProjectViewer('bob', makeId)).toBe(true)
    expect(await db.chat.isMakeProjectViewer('carol', makeId)).toBe(false)
    const personal = await db.chat.createConversation('alice', 'Личный макет', 'make')
    expect(await db.chat.isMakeProjectViewer('bob', personal.id)).toBe(false)
  })
})
