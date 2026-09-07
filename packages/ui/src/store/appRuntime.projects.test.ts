// Окружение jsdom вопреки имени файла (без `.dom.`): компоненты здесь не
// рендерятся, но стор пишет предпочтения в localStorage.
// @vitest-environment jsdom
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

// Выбор проекта в сайдбаре персистится в localStorage — чистим между тестами,
// иначе выбор из одного кейса протекает в следующий.
beforeEach(() => {
  localStorage.removeItem('vc.sidebar.project')
  localStorage.removeItem('vc.board.includeCompleted')
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

  it('openProject без доски берёт только детали, ensureBoard догружает её один раз', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    const board = vi.spyOn(api, 'board:get')
    const view = vi.spyOn(api, 'board:getView')
    const statuses = vi.spyOn(api, 'board:getStatuses')
    const detail = vi.spyOn(api, 'projects:get')

    // Релизы/настройки/код: доска не показывается — и не грузится.
    await store.actions.openProject(id, { board: false })
    expect(store.getState().activeProjectId).toBe(id)
    expect(store.getState().projectDetail?.id).toBe(id)
    expect(store.getState().board).toBeNull()
    expect(store.getState().boardLoading).toBe(false)
    expect(board).not.toHaveBeenCalled()
    expect(view).not.toHaveBeenCalled()
    expect(statuses).not.toHaveBeenCalled()
    expect(detail.mock.calls.length).toBe(1)

    // Переход на вкладку доски догружает её, детали не перечитываются.
    await store.actions.ensureBoard(id)
    expect(store.getState().board?.columns.length).toBeGreaterThan(0)
    expect(board.mock.calls.length).toBe(1)
    expect(detail.mock.calls.length).toBe(1)

    // Повторный вход на ту же вкладку доску не перезапрашивает.
    await store.actions.ensureBoard(id)
    expect(board.mock.calls.length).toBe(1)
  })

  it('ensureBoard на чужом проекте открывает его целиком', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const first = store.getState().projectDetail!.id
    await store.actions.createProject({ name: 'P2' })
    const second = store.getState().projectDetail!.id
    await store.actions.openProject(first, { board: false })
    await store.actions.ensureBoard(second)
    expect(store.getState().activeProjectId).toBe(second)
    expect(store.getState().board?.columns.length).toBeGreaterThan(0)
  })

  it('доска рисуется по скелету, состояние карточек догружается второй фазой', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    const column = store.getState().board!.columns[0]!
    await store.actions.createTask(column.id, { title: 'Двухфазная' })

    const gate = deferred<void>()
    const real = api['board:getStatuses']
    api['board:getStatuses'] = vi.fn(async (arg: { id: string; includeCompleted?: boolean }) => {
      await gate.promise
      return real(arg)
    })
    const opened = store.actions.openBoard(id)
    // Пока вторая фаза в пути, доска уже показывает карточки: ради этого и
    // разделили запросы — старт не ждёт обхода таблиц ранов на сервере.
    await vi.waitFor(() => expect(store.getState().board?.tasks.map((t) => t.title)).toContain('Двухфазная'))
    expect(store.getState().board!.tasks[0]!.mergePermitted).toBeUndefined()

    gate.resolve()
    await opened
    expect(store.getState().board!.tasks[0]!.mergePermitted).toBe(false)
    expect(store.getState().board!.tasks.map((t) => t.title)).toContain('Двухфазная')
  })

  it('включённый «показывать завершённые» не утяжеляет старт: сначала окно, потом догрузка', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    // Фильтр включён и сохранён в виде доски на сервере — как у постоянного пользователя.
    await store.actions.setBoardIncludeCompleted(true)
    store.actions.closeBoard()

    const calls: Array<boolean | undefined> = []
    const real = api['board:get']
    api['board:get'] = vi.fn(async (arg: { id: string; includeCompleted?: boolean }) => {
      calls.push(arg.includeCompleted)
      return real(arg)
    })
    await store.actions.openBoard(id)
    await vi.waitFor(() => expect(store.getState().boardIncludeCompleted).toBe(true))
    // Первый запрос — без завершённых, и только следом полный.
    expect(calls[0]).toBe(false)
    expect(calls).toContain(true)
  })

  it('отказ второй фазы не роняет уже показанную доску', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    api['board:getStatuses'] = vi.fn(async () => { throw new Error('нет связи') })
    await store.actions.openBoard(id)
    expect(store.getState().board?.columns.length).toBeGreaterThan(0)
    expect(store.getState().boardError).toBeNull()
  })

  it('роль понизили: refreshMembership перечитывает проект, и владельческие действия исчезают', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    expect(store.getState().projectDetail?.role).toBe('owner')

    const owned = api['projects:get']
    api['projects:get'] = vi.fn(async (arg: { id: string }) => {
      const detail = await owned(arg)
      return detail ? { ...detail, role: 'member' as const } : null
    })
    await store.actions.refreshMembership(id)
    expect(store.getState().projectDetail?.role).toBe('member')
    // Молча исчезнувшая кнопка читается как поломка — смену роли проговариваем.
    const notice = store.getState().notices.at(-1)
    expect(notice?.kind).toBe('info')
    expect(notice?.text).toContain('только для чтения')
  })

  it('роль не менялась — лишнего сообщения нет', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    const before = store.getState().notices.length
    await store.actions.refreshMembership(id)
    expect(store.getState().notices.length).toBe(before)
  })

  it('refreshMembership чужого проекта детали открытого не трогает', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    await store.actions.refreshMembership('другой-проект')
    expect(store.getState().projectDetail?.id).toBe(id)
    expect(store.getState().projectDetail?.role).toBe('owner')
  })

  it('доступ отобрали при открытой доске: проект закрывается, а не висит с «Повторить»', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    expect(store.getState().board).not.toBeNull()

    // Владелец исключил участника: сервер отвечает 404 на всё по этому проекту.
    const gone = Object.assign(new Error('Объект не найден.'), { status: 404 })
    api['board:get'] = vi.fn(async () => { throw gone })
    api['projects:get'] = vi.fn(async () => { throw gone })
    api['projects:list'] = vi.fn(async () => [])
    await store.actions.openBoard(id)

    expect(store.getState().activeProjectId).toBeNull()
    expect(store.getState().board).toBeNull()
    expect(store.getState().projects.some((p) => p.id === id)).toBe(false)
    // «Повторить» бессмысленно: повтор упрётся в тот же отказ.
    expect(store.getState().notices.at(-1)?.retry).toBeUndefined()
    expect(store.getState().notices.at(-1)?.text).toContain('Доступ к проекту закрыт')
  })

  it('обычный сбой чтения доски проект не закрывает и оставляет «Повторить»', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    api['board:get'] = vi.fn(async () => { throw new Error('Сеть недоступна') })
    await store.actions.openBoard(id)

    expect(store.getState().activeProjectId).toBe(id)
    expect(store.getState().boardError).toBe('Сеть недоступна')
    expect(store.getState().notices.at(-1)?.retry).toBeTypeOf('function')
  })

  it('включение показа завершённых немедленно скрывает старую доску до нового снимка', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    const oldBoard = store.getState().board!
    const nextBoard = { ...oldBoard, tasks: [] }
    const request = deferred<typeof nextBoard>()
    api['board:get'] = vi.fn(async ({ includeCompleted }) => {
      expect(includeCompleted).toBe(true)
      return await request.promise
    })

    const pending = store.actions.setBoardIncludeCompleted(true)

    expect(store.getState()).toMatchObject({
      boardIncludeCompleted: true,
      board: null,
      boardLoading: true,
      boardError: null
    })
    request.resolve(nextBoard)
    await pending
    expect(store.getState()).toMatchObject({
      board: nextBoard,
      boardLoading: false,
      boardError: null
    })
  })

  it('выключение показа завершённых также скрывает старую доску до нового снимка', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    await store.actions.setBoardIncludeCompleted(true)
    const oldBoard = store.getState().board!
    const nextBoard = { ...oldBoard, tasks: [] }
    const request = deferred<typeof nextBoard>()
    api['board:get'] = vi.fn(async ({ includeCompleted }) => {
      expect(includeCompleted).toBe(false)
      return await request.promise
    })

    const pending = store.actions.setBoardIncludeCompleted(false)

    expect(store.getState()).toMatchObject({
      boardIncludeCompleted: false,
      board: null,
      boardLoading: true,
      boardError: null
    })
    request.resolve(nextBoard)
    await pending
    expect(store.getState()).toMatchObject({
      board: nextBoard,
      boardLoading: false,
      boardError: null
    })
  })

  // Настройка взгляда, а не сессии: после перезагрузки страницы (и после деплоя)
  // «Показывать завершённые» раньше всегда возвращался в выключённое состояние.
  it('показ завершённых переживает перезапуск приложения', async () => {
    const { store } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    await store.actions.openBoard(store.getState().projectDetail!.id)
    await store.actions.setBoardIncludeCompleted(true)
    expect(localStorage.getItem('vc.board.includeCompleted')).toBe('1')

    const restarted = createTestStore({ api: createFakeApi(), now: () => 1_700_000_000_000 })
    expect(restarted.getState().boardIncludeCompleted).toBe(true)

    await restarted.actions.setBoardIncludeCompleted(false)
    expect(localStorage.getItem('vc.board.includeCompleted')).toBeNull()
  })

  it('ошибка смены фильтра завершает лоадер и штатный повтор снова запускает загрузку', async () => {
    const { store, api } = makeStore()
    await store.actions.createProject({ name: 'P1' })
    const id = store.getState().projectDetail!.id
    await store.actions.openBoard(id)
    const retryBoard = store.getState().board!
    const retryRequest = deferred<typeof retryBoard>()
    let attempt = 0
    api['board:get'] = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('Снимок недоступен')
      return await retryRequest.promise
    })

    await store.actions.setBoardIncludeCompleted(true)

    expect(store.getState()).toMatchObject({
      board: null,
      boardLoading: false,
      boardError: 'Снимок недоступен'
    })
    const notice = store.getState().notices.at(-1)!
    expect(notice.retry).toBeTypeOf('function')

    notice.retry?.()
    expect(store.getState()).toMatchObject({
      board: null,
      boardLoading: true,
      boardError: null
    })
    retryRequest.resolve(retryBoard)
    await vi.waitFor(() => expect(store.getState().boardLoading).toBe(false))
    expect(store.getState().board).not.toBeNull()
    expect(store.getState().boardError).toBeNull()
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


  it('ссылка на чат другого проекта не меняет фильтр сайдбара', async () => {
    const { store } = makeStore()
    // Список бесед открыт — значит индекс загружен (на доске его не грузят).
    await store.actions.ensureConversationIndex()
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
    expect(store.getState().sidebarProjectIds).toEqual([])
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

  it('applyBoardChanged refetch-ит только активный проект', async () => {
    vi.useFakeTimers()
    try {
      const { store, api } = makeStore()
      await store.actions.createProject({ name: 'P1' })
      const id = store.getState().projectDetail!.id
      await store.actions.openBoard(id)
      const column = store.getState().board!.columns[0]!
      await store.actions.createTask(column.id, { title: 'До action' })
      const task = store.getState().board!.tasks[0]!
      await api['tasks:update']({ projectId: id, taskId: task.id, title: 'После action' })

      store.actions.applyBoardChanged('other')
      await vi.advanceTimersByTimeAsync(450)
      expect(store.getState().board!.tasks[0]?.title).toBe('До action')

      store.actions.applyBoardChanged(id)
      await vi.advanceTimersByTimeAsync(450)
      expect(store.getState().board!.tasks[0]?.title).toBe('После action')
    } finally {
      vi.useRealTimers()
    }
  })

  it('поток board.changed не превращается в поток запросов доски, но и не замирает', async () => {
    vi.useFakeTimers()
    try {
      const { store, api } = makeStore()
      await store.actions.createProject({ name: 'P1' })
      const id = store.getState().projectDetail!.id
      await store.actions.openBoard(id)
      const get = vi.spyOn(api, 'board:get')

      // Активный ран шлёт событие каждые 400 мс: раньше это давало запрос почти на
      // каждое, теперь их склеивает дебаунс, а потолок ожидания не даёт доске замереть.
      for (let i = 0; i < 15; i++) {
        store.actions.applyBoardChanged(id)
        await vi.advanceTimersByTimeAsync(400)
      }
      await vi.advanceTimersByTimeAsync(500)
      expect(get.mock.calls.length).toBeGreaterThan(1)
      expect(get.mock.calls.length).toBeLessThanOrEqual(5)
    } finally {
      vi.useRealTimers()
    }
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

describe('voiceStore — мультивыбор проектов в сайдбаре', () => {
  it('полный, частичный и пустой выбор фильтруют чаты, включая чат без проекта только полностью', async () => {
    const { store } = makeStore()
    await store.actions.ensureConversationIndex()
    await store.actions.createProject({ name: 'P' })
    const pid = store.getState().projectDetail!.id
    await store.actions.syncSidebarProjects([pid, 'p2'])
    store.actions.setDraft('Без проекта')
    await store.actions.submitText()
    const noProject = store.getState().activeId!
    await store.actions.setConversationProject(noProject, pid)
    await store.actions.newConversation()
    store.actions.setDraft('Непривязанный')
    await store.actions.submitText()
    const unassigned = store.getState().activeId!

    expect(store.getState().conversations.map((item) => item.id)).toEqual([unassigned, noProject])
    await store.actions.setSidebarProjectIds([pid])
    expect(store.getState().conversations.map((item) => item.id)).toEqual([noProject])
    await store.actions.setSidebarProjectIds([])
    expect(store.getState().conversations).toEqual([])
  })

  it('восстанавливает пустой выбор и нормализует удалённые и новые проекты', async () => {
    const { store } = makeStore()
    await store.actions.syncSidebarProjects(['p1', 'p2'])
    await store.actions.setSidebarProjectIds(['p1'])
    const store2 = createTestStore({ api: createFakeApi(), now: () => 1_700_000_000_000 })
    await store2.actions.syncSidebarProjects(['p1', 'p3'])
    expect(store2.getState().sidebarProjectIds).toEqual(['p1', 'p3'])
    expect(store2.getState().sidebarProjectKnownIds).toEqual(['p1', 'p3'])

    await store2.actions.setSidebarProjectIds([])
    const store3 = createTestStore({ api: createFakeApi(), now: () => 1_700_000_000_000 })
    await store3.actions.syncSidebarProjects(['p1', 'p3'])
    expect(store3.getState().sidebarProjectIds).toEqual([])
  })

  it('повреждённое значение сбрасывает в полный режим, legacy id мигрирует', async () => {
    localStorage.setItem('vc.sidebar.project', '{broken')
    const damaged = createTestStore({ api: createFakeApi(), now: () => 1_700_000_000_000 })
    await damaged.actions.syncSidebarProjects(['p1', 'p2'])
    expect(damaged.getState().sidebarProjectIds).toEqual(['p1', 'p2'])

    localStorage.setItem('vc.sidebar.project', 'p1')
    const legacy = createTestStore({ api: createFakeApi(), now: () => 1_700_000_000_000 })
    await legacy.actions.syncSidebarProjects(['p1', 'p2'])
    expect(legacy.getState().sidebarProjectIds).toEqual(['p1'])
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
