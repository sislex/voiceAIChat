import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createVoiceStore, type VoiceStore } from './voiceStore'
import { createFakeApi, type FakeApi } from '../test/fakeApi'
import { DEFAULT_AGENT_POLICY } from '@shared/agentProtocol'
import type { Message } from '@shared/types'

function makeStore(): { store: VoiceStore; api: FakeApi } {
  const api = createFakeApi()
  const store = createVoiceStore({ api, now: () => 1_700_000_000_000 })
  return { store, api }
}

// Выбор проекта в сайдбаре персистится в localStorage — чистим между тестами,
// иначе выбор из одного кейса протекает в следующий.
beforeEach(() => {
  localStorage.removeItem('vc.sidebar.project')
})

describe('voiceStore — проекты и доска', () => {
  it('createProject наполняет список и панель деталей', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1', technologies: ['ts'] })
    expect(store.getState().projects.map((p) => p.name)).toContain('P1')
    expect(store.getState().projectDetail?.name).toBe('P1')
    expect(store.getState().projectDetail?.role).toBe('owner')
  })

  it('openBoard грузит доску с дефолтными колонками', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    expect(store.getState().activeProjectId).toBe(id)
    expect(store.getState().board?.columns.map((c) => c.name)).toEqual(['Бэклог', 'Готово к разработке', 'В разработке', 'Тестирование', 'Ожидает мержа', 'Готово'])
  })

  it('навыки по умолчанию проекта попадают в новую задачу, openTaskChat открывает связанный чат', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1', defaultSkills: { epic: [], story: [], task: ['ts'] } })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    const todo = store.getState().board!.columns[0]
    await store.actions.createTask(todo.id, { title: 'Задача A' })
    const task = store.getState().board!.tasks.find((t) => t.title === 'Задача A')!
    expect(task.skills).toEqual(['ts'])
    await store.actions.setSidebarProject(store.getState().projectDetail!.id)
    await store.actions.openTaskChat(task.id)
    const active = store.getState().activeId
    const conv = store.getState().conversations.find((c) => c.id === active)!
    expect(conv.taskId).toBe(task.id)
    expect(conv.skillNames).toEqual(['ts'])
    // Карточка на доске теперь знает про связанный чат.
    expect(store.getState().board!.tasks.find((t) => t.id === task.id)!.chatId).toBe(active)
  })


  it('createColumn и createTask отражаются в board', async () => {

    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    await store.actions.createColumn('Review')
    expect(store.getState().board!.columns.map((c) => c.name)).toEqual(['Бэклог', 'Готово к разработке', 'В разработке', 'Тестирование', 'Ожидает мержа', 'Готово', 'Review'])
    const todo = store.getState().board!.columns[0]
    await store.actions.createTask(todo.id, { title: 'Задача A' })
    expect(store.getState().board!.tasks.map((t) => t.title)).toContain('Задача A')
  })

  it('moveTask оптимистично меняет колонку и зовёт tasks:move', async () => {
    const { store, api } = makeStore()
    const spy = vi.spyOn(api, 'tasks:move')
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    const [todo, doing] = store.getState().board!.columns
    await store.actions.createTask(todo.id, { title: 'A' })
    const taskA = store.getState().board!.tasks.find((t) => t.title === 'A')!
    await store.actions.moveTask(taskA.id, doing.id, null, null)
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: taskA.id, columnId: doing.id })
    )
    expect(store.getState().board!.tasks.find((t) => t.id === taskA.id)!.columnId).toBe(doing.id)
  })

  it('applyBoardUpdate заменяет доску только активного проекта', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    store.actions.applyBoardUpdate('other', { columns: [], tasks: [] })
    expect(store.getState().board!.columns.length).toBeGreaterThan(0) // чужой — игнор
    store.actions.applyBoardUpdate(id, { columns: [], tasks: [] })
    expect(store.getState().board!.columns).toEqual([])
  })

  it('closeProjects сбрасывает состояние проектов и доски', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    store.actions.closeProjects()
    const s = store.getState()
    expect(s.projectsOpen).toBe(false)
    expect(s.activeProjectId).toBeNull()
    expect(s.board).toBeNull()
    expect(s.projectDetail).toBeNull()
  })
})

describe('voiceStore — связка проекта с чатом', () => {
  it('setConversationProject применяет машину/папку/навыки проекта к активному чату', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P', skills: ['ts'] })
    const pid = store.getState().projectDetail!.id
    const ag = await api['agents:create']({ name: 'M1' })
    await store.actions.linkProjectMachine(pid, ag.id)
    await store.actions.setProjectMachinePath(pid, ag.id, '/srv/p')
    await store.actions.setProjectDefaultMachine(pid, ag.id)
    await store.actions.newConversation()
    const cid = store.getState().activeId!
    await store.actions.setConversationProject(cid, pid)
    const conv = store.getState().conversations.find((c) => c.id === cid)!
    expect(conv.projectId).toBe(pid)
    expect(conv.execTarget).toBe(ag.id)
    expect(conv.workdir).toBe('/srv/p')
    expect(conv.skillNames).toEqual(['ts'])
  })

  it('openUtilityForActiveChat открывает на машине+папке активного чата; explorer — как папку', async () => {
    const { store } = makeStore()
    await store.actions.newConversation()
    const cid = store.getState().activeId!
    await store.actions.setConversationExecTarget(cid, 'm1', '/srv/p')
    store.actions.applyAgents([
      { id: 'm1', name: 'M1', online: true, createdAt: 1, lastSeen: null, policy: DEFAULT_AGENT_POLICY }
    ])
    store.actions.openUtilityForActiveChat('explorer')
    const u = store.getState().utility!
    expect(u.agentId).toBe('m1')
    expect(u.path).toBe('/srv/p')
    expect(u.dir).toBe(true)
    store.actions.openUtilityForActiveChat('console')
    expect(store.getState().utility!.dir).toBeUndefined()
    expect(store.getState().utility!.path).toBe('/srv/p')
  })
})

describe('voiceStore — выбор проекта в сайдбаре', () => {
  it('setSidebarProject сужает список до чатов проекта и до «Без проекта»', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P' })
    const pid = store.getState().projectDetail!.id
    await store.actions.newConversation()
    const inProj = store.getState().activeId!
    await store.actions.setConversationProject(inProj, pid)
    await store.actions.newConversation()
    const noProj = store.getState().activeId!

    await store.actions.setSidebarProject(pid)
    expect(store.getState().sidebarProjectId).toBe(pid)
    expect(store.getState().conversations.map((c) => c.id)).toEqual([inProj])

    await store.actions.setSidebarProject(null)
    expect(store.getState().conversations.map((c) => c.id)).toEqual([noProj])
  })

  it('newConversation при выбранном проекте создаёт чат сразу в нём', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P' })
    const pid = store.getState().projectDetail!.id
    const spy = vi.spyOn(api, 'conversations:setProject')
    await store.actions.setSidebarProject(pid)
    await store.actions.newConversation()
    const cid = store.getState().activeId!
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: cid, projectId: pid }))
    expect(store.getState().conversations.find((c) => c.id === cid)!.projectId).toBe(pid)
  })

  it('последний выбранный проект восстанавливается из localStorage', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P' })
    const pid = store.getState().projectDetail!.id
    await store.actions.setSidebarProject(pid)
    const store2 = createVoiceStore({ api: createFakeApi(), now: () => 1_700_000_000_000 })
    expect(store2.getState().sidebarProjectId).toBe(pid)
  })
})

describe('voiceStore — резюме CI-рана в связанном чате', () => {
  it('applyChatMessage дописывает резюме в открытый чат, чужое и повторное — игнорирует', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    const todo = store.getState().board!.columns[0]
    await store.actions.createTask(todo.id, { title: 'Скролл' })
    const task = store.getState().board!.tasks.find((t) => t.title === 'Скролл')!
    await store.actions.setSidebarProject(store.getState().projectDetail!.id)
    await store.actions.openTaskChat(task.id)
    const chatId = store.getState().activeId!
    // Имя связанного чата по умолчанию — «Задача <заголовок>».
    expect(store.getState().conversations.find((c) => c.id === chatId)!.title).toBe('Задача Скролл')

    const summary: Message = {
      id: 'sum-1',
      conversationId: chatId,
      role: 'ai',
      text: 'Резюме по задаче P1-1 · Скролл\n\nготово',
      time: '10:00',
      createdAt: 1,
      meta: { ciRunSummary: { runId: 'run-1' } }
    }
    store.actions.applyChatMessage(chatId, summary)
    expect(store.getState().messages.map((m) => m.id)).toContain('sum-1')
    // Реплей того же сообщения после reconnect не даёт дубля.
    store.actions.applyChatMessage(chatId, summary)
    expect(store.getState().messages.filter((m) => m.id === 'sum-1')).toHaveLength(1)
    // Резюме другого чата в открытый не попадает — оно придёт с историей.
    store.actions.applyChatMessage('other', { ...summary, id: 'sum-2', conversationId: 'other' })
    expect(store.getState().messages.map((m) => m.id)).not.toContain('sum-2')
  })
})
