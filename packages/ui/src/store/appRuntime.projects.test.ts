import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestStore, type TestStore } from '../test/appHarness'
import { createFakeApi, type FakeApi } from '../test/fakeApi'
import { DEFAULT_AGENT_POLICY } from '@shared/agentProtocol'
import type { Message } from '@shared/types'

function makeStore(): { store: TestStore; api: FakeApi } {
  const api = createFakeApi()
  const store = createTestStore({ api, now: () => 1_700_000_000_000 })
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
    expect(store.getState().board?.columns.map((c) => c.semanticType)).toEqual(['backlog', 'preparation', 'ready', 'development', 'component_qa', 'integration_tests', 'automated_qa', 'manual_qa', 'awaiting_merge', 'merge', 'done', 'cancelled', 'decision_required'])
  })

  it('createTaskAndStartCi создаёт задачу и запускает CI с моделью из предложения', async () => {
    const api = createFakeApi()
    const startRun = vi.fn(async (_projectId: string, taskId: string) => ({
      id: 'run-1', projectId: 'project', taskId, status: 'queued', slotProgress: null, durationMs: null
    }))
    const store = createTestStore({ api, ci: { startRun } as never })
    const project = await api['projects:create']({ name: 'P1' })

    const run = await store.actions.createTaskAndStartCi(project.id, {
      title: 'Из предложения', description: 'Описание', acceptanceCriteria: 'Критерий', provider: 'codex', model: 'gpt-5'
    })

    expect(run?.id).toBe('run-1')
    expect(startRun).toHaveBeenCalledWith(project.id, expect.any(String), { provider: 'codex', model: 'gpt-5' })
    const board = await api['board:get']({ id: project.id })
    expect(board.tasks.some((task) => task.title === 'Из предложения')).toBe(true)
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


  it('ссылка на чат другого проекта переключает фильтр сайдбара', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const p1 = store.getState().projectDetail!.id
    await store.actions.setSidebarProject(p1)
    store.actions.setDraft('Чат P1')
    await store.actions.submitText()
    const inP1 = store.getState().activeId!
    store.actions.cancelRequest()
    await store.actions.setSidebarProject(null)
    expect(store.getState().conversations.some((c) => c.id === inP1)).toBe(false)

    const ok = await store.actions.selectConversation(inP1)

    expect(ok).toBe(true)
    expect(store.getState().activeId).toBe(inP1)
    expect(store.getState().sidebarProjectId).toBe(p1)
    expect(store.getState().conversations.some((c) => c.id === inP1)).toBe(true)
  })

  it('createColumn и createTask отражаются в board', async () => {

    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    await store.actions.createColumn('Review')
    expect(store.getState().board!.columns.map((c) => c.semanticType)).toEqual(['backlog', 'preparation', 'ready', 'development', 'component_qa', 'integration_tests', 'automated_qa', 'manual_qa', 'awaiting_merge', 'merge', 'done', 'cancelled', 'decision_required', 'custom'])
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

  it('moveTask сохраняет порядок Done по последнему входу после обновления доски', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.updateProject(store.getState().projectDetail!.id, { doneRetentionDays: null })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    const board = store.getState().board!
    const dev = board.columns.find((column) => column.semanticType === 'development')!
    const done = board.columns.find((column) => column.semanticType === 'done')!
    await store.actions.createTask(dev.id, { title: 'Первая' })
    await store.actions.createTask(dev.id, { title: 'Вторая' })
    const [first, second] = store.getState().board!.tasks.filter((task) => task.columnId === dev.id)

    await store.actions.moveTask(first!.id, done.id)
    await store.actions.moveTask(second!.id, done.id)
    await store.actions.updateTask(second!.id, { title: 'Вторая (исправлена)' })
    expect(store.getState().board!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([second!.id, first!.id])

    await store.actions.moveTask(first!.id, dev.id)
    await store.actions.moveTask(first!.id, done.id)
    expect(store.getState().board!.tasks.filter((task) => task.columnId === done.id).map((task) => task.id))
      .toEqual([first!.id, second!.id])
  })

  it('applyBoardUpdate синхронизирует UI после action только для активного проекта', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    const initial = store.getState().board!
    const column = initial.columns[0]!
    await store.actions.createTask(column.id, { title: 'До action' })
    const current = store.getState().board!
    const changed = { ...current, tasks: current.tasks.map((task) => ({ ...task, title: 'После action', updatedAt: task.updatedAt + 1 })) }
    store.actions.applyBoardUpdate('other', changed)
    expect(store.getState().board!.tasks[0]?.title).toBe('До action')
    store.actions.applyBoardUpdate(id, changed)
    expect(store.getState().board!.tasks[0]?.title).toBe('После action')
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
    await api['projects:setDefaultMachine']({ id: pid, agentId: ag.id })
    store.actions.setDraft('Обычный чат')
    await store.actions.submitText()
    store.actions.cancelRequest()
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
    store.actions.setDraft('Обычный чат')
    await store.actions.submitText()
    store.actions.cancelRequest()
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

  it('openUtilityForActiveChat сохраняет целевую офлайн-машину, чтобы показать её переподключение', async () => {
    const { store } = makeStore()
    store.actions.setDraft('Обычный чат')
    await store.actions.submitText()
    store.actions.cancelRequest()
    const cid = store.getState().activeId!
    await store.actions.setConversationExecTarget(cid, 'm1', '/srv/p')
    store.actions.applyAgents([
      { id: 'm1', name: 'MacBook', online: false, createdAt: 1, lastSeen: null, policy: DEFAULT_AGENT_POLICY },
      { id: 'm2', name: 'Linux', online: true, createdAt: 1, lastSeen: null, policy: DEFAULT_AGENT_POLICY }
    ])

    store.actions.openUtilityForActiveChat('console')

    expect(store.getState().utility!.agentId).toBe('m1')
  })
})

describe('voiceStore — выбор проекта в сайдбаре', () => {
  it('setSidebarProject сужает список до чатов проекта и до «Без проекта»', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P' })
    const pid = store.getState().projectDetail!.id
    store.actions.setDraft('Проектный')
    await store.actions.submitText()
    store.actions.cancelRequest()
    const inProj = store.getState().activeId!
    await store.actions.setConversationProject(inProj, pid)
    await store.actions.newConversation()
    store.actions.setDraft('Без проекта')
    await store.actions.submitText()
    store.actions.cancelRequest()
    const noProj = store.getState().activeId!

    await store.actions.setSidebarProject(pid)
    expect(store.getState().sidebarProjectId).toBe(pid)
    expect(store.getState().conversations.map((c) => c.id)).toEqual([inProj])

    await store.actions.setSidebarProject(null)
    expect(store.getState().conversations.map((c) => c.id)).toEqual([noProj])
  })

  it('проектный черновик сохраняется в проекте только при первой отправке', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P' })
    const pid = store.getState().projectDetail!.id
    const spy = vi.spyOn(api, 'conversations:createDraft')
    await store.actions.setSidebarProject(pid)
    await store.actions.newConversation()
    expect(api._state.conversations).toHaveLength(0)
    store.actions.setDraft('Первая реплика')
    await store.actions.submitText()
    const cid = store.getState().activeId!
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ projectId: pid }))
    expect(store.getState().conversations.find((c) => c.id === cid)!.projectId).toBe(pid)
  })

  it('последний выбранный проект восстанавливается из localStorage', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P' })
    const pid = store.getState().projectDetail!.id
    await store.actions.setSidebarProject(pid)
    const store2 = createTestStore({ api: createFakeApi(), now: () => 1_700_000_000_000 })
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
    // Сообщение в чужой чат ставит отложенное обновление сайдбара (оно проверено
    // в `voiceStore.sidebar.test.ts`) — гасим таймер, чтобы не тёк в соседний кейс.
    store.actions.dispose()
  })
})

describe('voiceStore — метки чатов задач в списке бесед', () => {
  it('метка появляется вместе с чатом задачи, у обычного чата её нет', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    const todo = store.getState().board!.columns[0]
    await store.actions.createTask(todo.id, { title: 'Скролл' })
    const task = store.getState().board!.tasks.find((t) => t.title === 'Скролл')!
    await store.actions.setSidebarProject(store.getState().projectDetail!.id)
    await store.actions.openTaskChat(task.id)
    const chatId = store.getState().activeId!
    // Метки грузятся вдогонку списку бесед — ждём микрозадачу запроса.
    await Promise.resolve()
    await Promise.resolve()
    const badges = store.getState().taskChatBadges
    expect(badges[chatId]).toMatchObject({ taskId: task.id, key: 'P1-1', type: 'task' })
    expect(Object.keys(badges)).toEqual([chatId])
  })
})

describe('voiceStore — канал уведомлений', () => {
  it('упавший вызов моста кладёт ошибку с безопасным повтором', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    const real = api['board:get']
    let broken = true
    api['board:get'] = async (input) => {
      if (!broken) return real(input)
      broken = false
      throw new Error('Сервер недоступен')
    }

    await store.actions.openBoard(id)
    const [notice] = store.getState().notices
    expect(notice.kind).toBe('error')
    expect(notice.text).toBe('Сервер недоступен')
    // Загрузка доски идемпотентна — повтор безопасен, поэтому он есть.
    expect(notice.retry).toBeTypeOf('function')
    expect(store.getState().boardLoading).toBe(false)

    notice.retry?.()
    await vi.waitFor(() => expect(store.getState().board).not.toBeNull())

    // Показанное уведомление снимает тот, кто его показал (App).
    store.actions.dismissNotice(notice.id)
    expect(store.getState().notices).toHaveLength(0)
  })

  it('создание не получает «Повторить» — иначе после «упало, но применилось» будет дубль', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    api['columns:create'] = async () => {
      throw new Error('нет сети')
    }
    await store.actions.createColumn('Новая')
    const notice = store.getState().notices.at(-1)!
    expect(notice.text).toBe('нет сети')
    expect(notice.retry).toBeUndefined()
  })

  it('notify кладёт успех в ту же очередь', () => {
    const { store } = makeStore()
    store.actions.notify({ kind: 'success', text: 'Настройки сохранены' })
    expect(store.getState().notices).toEqual([{ id: expect.any(String), kind: 'success', text: 'Настройки сохранены' }])
  })
})

// Виджет задачи в чате — свойство открытого чата, а не состояние стора: любая
// смена активного чата обязана его убрать, не дожидаясь ответа сервера.
describe('voiceStore — контекст задачи не залипает при смене чата', () => {
  /** Проект с задачей и открытым связанным чатом (контекст уже загружен). */
  async function openedTaskChat(): Promise<{ store: TestStore; api: FakeApi; chatId: string }> {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const projectId = store.getState().projectDetail!.id
    await store.actions.openBoard(projectId)
    await store.actions.createTask(store.getState().board!.columns[0]!.id, { title: 'Задача A' })
    const task = store.getState().board!.tasks.find((t) => t.title === 'Задача A')!
    const chatId = (await store.actions.openTaskChat(task.id))!
    await vi.waitFor(() => expect(store.getState().taskChatContext?.task.id).toBe(task.id))
    // Контекст знает свой чат — по нему рендер и сверяется.
    expect(store.getState().taskChatContext!.conversationId).toBe(chatId)
    return { store, api, chatId }
  }

  it('newConversation обнуляет контекст задачи', async () => {
    const { store } = await openedTaskChat()
    await store.actions.newConversation()
    expect(store.getState().taskChatContext).toBeNull()
  })

  it('resumeCcSession обнуляет контекст задачи', async () => {
    const { store } = await openedTaskChat()
    await store.actions.resumeCcSession('proj', 'sid-1')
    expect(store.getState().taskChatContext).toBeNull()
  })

  it('resumeCxSession обнуляет контекст задачи', async () => {
    const { store } = await openedTaskChat()
    await store.actions.resumeCxSession('sid-42')
    expect(store.getState().taskChatContext).toBeNull()
  })

  it('опоздавший ответ для уже закрытого чата не попадает в стор', async () => {
    const { store, api, chatId } = await openedTaskChat()
    const real = api['conversations:taskContext']
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    api['conversations:taskContext'] = async (arg) => {
      await gate
      return await real(arg)
    }
    const pending = store.actions.loadTaskChatContext(chatId)
    // Пока запрос в пути, пользователь ушёл в новый чат.
    await store.actions.newConversation()
    release()
    await pending
    expect(store.getState().taskChatContext).toBeNull()
  })
})
