import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database.js'

let db: VoiceChatDb

beforeEach(() => {
  let id = 0
  let clock = 1000
  db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
  db.identity.createUser('alice', '', 'developer')
  db.identity.createUser('bob', '', 'developer')
  db.identity.createUser('carol', '', 'developer')
})

afterEach(() => db.close())

/** Проект с одной задачей и Make-чатом, привязанным к этому же проекту. */
function scene(): { projectId: string; taskId: string; makeId: string } {
  const project = db.projects.createProject('alice', { name: 'Piara' })
  db.projects.addMember('alice', project.id, 'bob')
  const column = db.tasks.getBoard('alice', project.id)!.columns[0]
  const task = db.tasks.createTask('alice', project.id, { columnId: column.id, title: 'Экран оплаты' })!
  const make = db.chat.createConversation('alice', 'Проект 1', 'make')
  db.chat.setConversationProject('alice', make.id, project.id)
  return { projectId: project.id, taskId: task.id, makeId: make.id }
}

describe('дизайны карточки', () => {
  it('связывает задачу со страницей Make-проекта и отдаёт имя проекта вместе со связью', () => {
    const { projectId, taskId, makeId } = scene()
    const links = db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'pay.html', label: 'Оплата' })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ conversationId: makeId, conversationTitle: 'Проект 1', conversationOwner: 'alice', path: 'pay.html', label: 'Оплата' })
    expect(db.tasks.getTaskDetail('alice', projectId, taskId)!.designs).toHaveLength(1)
    // CI-ран получает те же связи: макет — часть постановки для модели.
    expect(db.tasks.getCiTask('alice', projectId, taskId)!.designs).toHaveLength(1)
  })

  it('повторная связь той же страницы не плодит дублей, а только обновляет подпись', () => {
    const { projectId, taskId, makeId } = scene()
    db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'pay.html' })
    const links = db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'pay.html', label: 'Оплата' })
    expect(links).toHaveLength(1)
    expect(links[0].label).toBe('Оплата')
  })

  it('источником может быть только Make-проект этого же проекта', () => {
    const { projectId, taskId } = scene()
    const plain = db.chat.createConversation('alice', 'Обычный чат')
    db.chat.setConversationProject('alice', plain.id, projectId)
    expect(() => db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: plain.id })).toThrow('Make')

    const foreign = db.chat.createConversation('alice', 'Чужой макет', 'make')
    expect(() => db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: foreign.id })).toThrow('не привязан')
  })

  it('путь страницы проверяется правилами Make, пустой путь означает проект целиком', () => {
    const { projectId, taskId, makeId } = scene()
    expect(() => db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: '../secrets' })).toThrow()
    expect(db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: '  ' })[0].path).toBe('')
  })

  it('нормализует детерминированный набор, дедуплицирует и атомарно заменяет его', () => {
    const { projectId, taskId, makeId } = scene()
    let links = db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'files', paths: ['src/App.tsx', 'index.html', 'src/App.tsx'] })
    expect(links[0]).toMatchObject({ mode: 'files', paths: ['index.html', 'src/App.tsx'] })
    links = db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'whole_project', paths: [] })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ mode: 'whole_project', paths: [] })
    expect(() => db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'files', paths: [] })).toThrow('хотя бы один')
    expect(() => db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'whole_project', paths: ['index.html'] })).toThrow('несовместим')
    expect(() => db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, mode: 'files', paths: ['/index.html'] })).toThrow('каноническим')
  })

  it('историческая чужая связь видна участнику, но новую связь с чужим Make-проектом создать нельзя', () => {
    const { projectId, taskId, makeId } = scene()
    db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'index.html' })
    expect(db.tasks.listTaskDesigns('bob', projectId, taskId)).toHaveLength(1)
    expect(db.tasks.getTaskDetail('bob', projectId, taskId)!.designs).toHaveLength(1)
    expect(() => db.tasks.linkTaskDesign('bob', projectId, taskId, { conversationId: makeId })).toThrow('только свой')
    expect(db.tasks.listTaskDesigns('carol', projectId, taskId)).toBeNull()
    expect(() => db.tasks.linkTaskDesign('carol', projectId, taskId, { conversationId: makeId })).toThrow()
  })

  it('снятие связи убирает её у задачи', () => {
    const { projectId, taskId, makeId } = scene()
    const [link] = db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'index.html' })
    expect(db.tasks.unlinkTaskDesign('alice', projectId, taskId, link.id)).toEqual([])
  })

  it('обратное направление: панель Make видит задачи своей страницы и умеет фильтровать по ней', () => {
    const { projectId, taskId, makeId } = scene()
    db.tasks.linkTaskDesign('alice', projectId, taskId, { conversationId: makeId, path: 'pay.html' })
    const column = db.tasks.getBoard('alice', projectId)!.columns[0]
    const other = db.tasks.createTask('alice', projectId, { columnId: column.id, title: 'Главная' })!
    db.tasks.linkTaskDesign('alice', projectId, other.id, { conversationId: makeId, path: 'index.html' })

    expect(db.tasks.makeTaskLinks(makeId)).toHaveLength(2)
    const onPage = db.tasks.makeTaskLinks(makeId, 'pay.html')
    expect(onPage).toHaveLength(1)
    expect(onPage[0]).toMatchObject({ taskId, taskKey: 'PIAR-1', taskTitle: 'Экран оплаты' })
  })

  it('панель Make предлагает карточки своего проекта только участнику', () => {
    const { makeId } = scene()
    expect(db.tasks.makeLinkableTasks('bob', makeId).map((t) => t.title)).toEqual(['Экран оплаты'])
    expect(db.tasks.makeLinkableTasks('carol', makeId)).toEqual([])
  })

  it('источники дизайна проекта — все и только собственные Make-проекты участника', () => {
    const { projectId, makeId } = scene()
    const first = db.chat.createConversation('bob', 'Bob 1', 'make')
    db.chat.setConversationProject('bob', first.id, projectId)
    const second = db.chat.createConversation('bob', 'Bob 2', 'make')
    db.chat.setConversationProject('bob', second.id, projectId)
    const other = db.chat.createConversation('alice', 'Alice 2', 'make')
    db.chat.setConversationProject('alice', other.id, projectId)

    const sources = db.tasks.projectDesignSources('bob', projectId)!
    expect(sources.map((source) => source.conversationId)).toEqual([second.id, first.id])
    expect(sources).toMatchObject([
      { title: 'Bob 2', owner: 'bob', own: true },
      { title: 'Bob 1', owner: 'bob', own: true }
    ])
    expect(sources.map((source) => source.conversationId)).not.toContain(makeId)
    expect(sources.map((source) => source.conversationId)).not.toContain(other.id)
    expect(db.tasks.projectDesignSources('carol', projectId)).toBeNull()
  })

  it('участник проекта читает привязанный к проекту Make-проект, посторонний — нет', () => {
    const { makeId } = scene()
    expect(db.chat.isMakeProjectViewer('bob', makeId)).toBe(true)
    expect(db.chat.isMakeProjectViewer('carol', makeId)).toBe(false)
    const personal = db.chat.createConversation('alice', 'Личный макет', 'make')
    expect(db.chat.isMakeProjectViewer('bob', personal.id)).toBe(false)
  })
})
