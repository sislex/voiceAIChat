// Список бесед сходится с сервером без действий пользователя.
//
// Видимость строки считает сервер (чат задачи в «Готово» из списка убран), а
// меняют её события: терминальные кадры рана, дописанное сервером сообщение,
// переезд карточки. Здесь проверяется именно проводка событий в перезапрос
// списка — сам фильтр живёт в `voiceStore.test.ts`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CONVERSATIONS_REFRESH_DEBOUNCE_MS, createVoiceStore, type VoiceStore } from './voiceStore'
import { createFakeApi, createFakeCi, type FakeApi } from '../test/fakeApi'
import { makeLogLine, makeRun, makeStep } from '../test/fixtures'
import type { CiRunSummary, CiStatus } from '@shared/ci'
import type { Message } from '@shared/types'

interface Scene {
  store: VoiceStore
  api: FakeApi
  projectId: string
  taskId: string
  /** Чат задачи (активным его делает только явный `selectConversation`). */
  chatId: string
  workColumnId: string
  doneColumnId: string
}

/** Проект с задачей в работе и её чатом; сайдбар сужен этим проектом. */
async function scene(): Promise<Scene> {
  const api = createFakeApi()
  const store = createVoiceStore({ api, now: () => 1_700_000_000_000 })
  const project = await api['projects:create']({ name: 'P' })
  const board = await api['board:get']({ id: project.id })
  const work = board.columns[0]!
  const done = board.columns.find((c) => c.semanticType === 'done')!
  const task = await api['tasks:create']({ projectId: project.id, columnId: work.id, title: 'Скролл' })
  const chat = await api['tasks:openChat']({ projectId: project.id, taskId: task.id })
  await store.actions.init()
  await store.actions.setSidebarProject(project.id)
  return {
    store,
    api,
    projectId: project.id,
    taskId: task.id,
    chatId: chat.id,
    workColumnId: work.id,
    doneColumnId: done.id
  }
}

const ids = (store: VoiceStore): string[] => store.getState().conversations.map((c) => c.id)

/** Проматывает окно склейки и даёт улететь отложенному `conversations:list`. */
async function flushRefresh(): Promise<void> {
  await vi.advanceTimersByTimeAsync(CONVERSATIONS_REFRESH_DEBOUNCE_MS + 1)
  await Promise.resolve()
}

const summaryOf = (taskId: string, status: CiStatus): CiRunSummary => ({
  id: 'run-1',
  taskId,
  status,
  slotProgress: { done: 4, total: 4, phase: 'после модели' },
  durationMs: 1000,
  modelActive: false,
  awaitingInput: false
})

const chatMessage = (conversationId: string): Message => ({
  id: `msg-${conversationId}`,
  conversationId,
  role: 'ai',
  text: 'Резюме по задаче P-1 · Скролл',
  time: '10:00',
  createdAt: 1,
  meta: { ciRunSummary: { runId: 'run-1' } }
})

beforeEach(() => {
  vi.useFakeTimers()
  // Выбор проекта в сайдбаре персистится — иначе он течёт в соседний кейс.
  localStorage.removeItem('vc.sidebar.project')
})
afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('voiceStore — исключение ожидающего CI-рана', () => {
  it('применяет подтверждённое сервером исключение, а начавшийся ран показывает как running', async () => {
    const ci = createFakeCi()
    const store = createVoiceStore({ api: createFakeApi(), ci })
    const queued = await store.actions.startCiRun('p1', 't1')
    expect(queued?.status).toBe('queued')

    await store.actions.dequeueCiRun(queued!.id)
    expect(store.getState().ciSummaries.t1?.status).toBe('cancelled')

    const raced = await store.actions.startCiRun('p1', 't1')
    ci.dequeueRun = async () => ({ status: 'running', run: { ...raced!, status: 'running' } })
    await store.actions.dequeueCiRun(raced!.id)

    expect(store.getState().ciSummaries.t1?.status).toBe('running')
    expect(store.getState().notices.at(-1)?.text).toContain('Ран уже выполняется')
  })
})

describe('voiceStore — сайдбар обновляется по событиям CI', () => {
  it('ci.done убирает из списка чат задачи, уехавшей в «Готово»', async () => {
    const s = await scene()
    await s.store.actions.newConversation() // ушли в другой чат: чат задачи — фоновый
    expect(ids(s.store)).toContain(s.chatId)

    // Сервер увёз карточку в «Готово» при финализации рана.
    await s.api['tasks:move']({ projectId: s.projectId, taskId: s.taskId, columnId: s.doneColumnId })
    s.store.actions.applyCiDone('run-1', makeRun({ projectId: s.projectId, taskId: s.taskId, status: 'success' }))
    await flushRefresh()

    expect(ids(s.store)).not.toContain(s.chatId)
  })

  it('ci.summary дёргает список только на терминальном статусе', async () => {
    const s = await scene()
    await s.store.actions.newConversation()
    await s.api['tasks:move']({ projectId: s.projectId, taskId: s.taskId, columnId: s.doneColumnId })

    // Ран ещё идёт — видимость чатов не менялась, список не трогаем.
    s.store.actions.applyCiSummary(s.projectId, summaryOf(s.taskId, 'running'))
    await flushRefresh()
    expect(ids(s.store)).toContain(s.chatId)

    // Сводка приходит и без подписки на ленту — для такой страницы это
    // единственный сигнал, что ран кончился.
    s.store.actions.applyCiSummary(s.projectId, summaryOf(s.taskId, 'success'))
    await flushRefresh()
    expect(ids(s.store)).not.toContain(s.chatId)
  })

  it('открытый чат завершённой задачи остаётся в списке', async () => {
    const s = await scene()
    expect(await s.store.actions.selectConversation(s.chatId)).toBe(true)

    await s.api['tasks:move']({ projectId: s.projectId, taskId: s.taskId, columnId: s.doneColumnId })
    s.store.actions.applyCiDone('run-1', makeRun({ projectId: s.projectId, taskId: s.taskId, status: 'success' }))
    await flushRefresh()

    // Строка закреплена: вместе с ней из шапки пропали бы машина и папка чата.
    expect(ids(s.store)).toContain(s.chatId)
    expect(s.store.getState().pinnedConversation?.id).toBe(s.chatId)
  })

  it('chat.message в неактивный чат задачи поднимает его строку в сайдбаре', async () => {
    const s = await scene()
    await s.store.actions.newConversation()
    // Чат второй задачи сервер создал уже после того, как список уехал клиенту.
    const task = await s.api['tasks:create']({ projectId: s.projectId, columnId: s.workColumnId, title: 'Вторая' })
    const chat = await s.api['tasks:openChat']({ projectId: s.projectId, taskId: task.id })
    expect(ids(s.store)).not.toContain(chat.id)

    s.store.actions.applyChatMessage(chat.id, chatMessage(chat.id))
    await flushRefresh()

    expect(ids(s.store)).toContain(chat.id)
    expect(ids(s.store)[0]).toBe(chat.id) // свежайшая беседа — наверху
    // Реплика чужого чата в открытую ленту не попадает.
    expect(s.store.getState().messages.map((m) => m.id)).not.toContain(`msg-${chat.id}`)
  })

  it('board.update с переездом карточки прячет и возвращает чат задачи', async () => {
    const s = await scene()
    await s.store.actions.newConversation()
    await s.store.actions.openBoard(s.projectId)

    await s.api['tasks:move']({ projectId: s.projectId, taskId: s.taskId, columnId: s.doneColumnId })
    s.store.actions.applyBoardUpdate(s.projectId, await s.api['board:get']({ id: s.projectId }))
    await flushRefresh()
    expect(ids(s.store)).not.toContain(s.chatId)

    // Карточку вернули в работу — строка возвращается без перезагрузки.
    await s.api['tasks:move']({ projectId: s.projectId, taskId: s.taskId, columnId: s.workColumnId })
    s.store.actions.applyBoardUpdate(s.projectId, await s.api['board:get']({ id: s.projectId }))
    await flushRefresh()
    expect(ids(s.store)).toContain(s.chatId)
  })

  it('поток кадров ленты список не дёргает, пачка терминальных — один раз', async () => {
    const s = await scene()
    const list = vi.spyOn(s.api, 'conversations:list')

    for (let i = 0; i < 20; i++) {
      s.store.actions.applyCiStep('run-1', makeStep({ id: `s${i}`, runId: 'run-1' }))
      s.store.actions.applyCiLog('run-1', makeLogLine({ seq: i, stepId: `s${i}` }))
    }
    await flushRefresh()
    expect(list).not.toHaveBeenCalled()

    // Конец рана: ci.done + сводка + резюме в фоновом чате — один запрос на всех.
    s.store.actions.applyCiDone('run-1', makeRun({ projectId: s.projectId, taskId: s.taskId, status: 'success' }))
    s.store.actions.applyCiSummary(s.projectId, summaryOf(s.taskId, 'success'))
    s.store.actions.applyChatMessage('другой-чат', chatMessage('другой-чат'))
    await flushRefresh()
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('voiceStore — список reader-чатов и гонка выбора', () => {
  it('readerConversations не сжимается фильтром проекта в сайдбаре', async () => {
    const api = createFakeApi()
    const store = createVoiceStore({ api, now: () => 1_700_000_000_000 })
    const project = await api['projects:create']({ name: 'P' })
    await store.actions.init()
    const readerId = await store.actions.newConversation('web-recorder')
    // Старый reader-чат без assistantKind, но с сохранённым previewUrl.
    const legacy = await api['conversations:create']({ title: 'Старый ридер' })
    await api['conversations:setPreviewUrl']({ id: legacy.id, previewUrl: 'https://example.com' })

    await store.actions.setSidebarProject(project.id)

    // Сайдбар сужен проектом: reader-чаты без проекта из него ушли…
    expect(store.getState().conversations.map((c) => c.id)).not.toContain(readerId)
    // …а список Web Reader остался полным — оба вида reader-чатов на месте.
    const readerIds = store.getState().readerConversations.map((c) => c.id)
    expect(readerIds).toContain(readerId)
    expect(readerIds).toContain(legacy.id)
    // Обычных чатов в нём нет и лишние reader-чаты не создавались.
    expect(api._state.conversations.filter((c) => c.assistantKind === 'web-recorder')).toHaveLength(1)
  })

  it('устаревший ответ conversations:get не перетирает только что созданный чат', async () => {
    const api = createFakeApi()
    const store = createVoiceStore({ api, now: () => 1_700_000_000_000 })
    const old = await api['conversations:create']({ title: 'Старый' })
    await api['messages:add']({ conversationId: old.id, role: 'u1', text: 'привет', time: '10:00' })
    await api['conversations:create']({ title: 'Свежий' })
    await store.actions.init()

    // Ответ на клик по старому чату задерживаем — за кликом сразу идёт «+ Новый».
    const realGet = api['conversations:get']
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    api['conversations:get'] = async (arg) => { await gate; return realGet(arg) }
    const pending = store.actions.selectConversation(old.id)
    api['conversations:get'] = realGet

    const readerId = await store.actions.newConversation('web-recorder')
    release()

    // Устаревший ответ отброшен молча: без ошибки и без перезаписи состояния.
    await expect(pending).resolves.toBe(false)
    expect(store.getState().activeId).toBe(readerId)
    expect(store.getState().messages).toHaveLength(0)
    expect(store.getState().error).toBeNull()
    expect(store.getState().loadingMessages).toBe(false)
  })

  it('новые reader-чаты получают различимые имена «Web Reader N»', async () => {
    const api = createFakeApi()
    const store = createVoiceStore({ api, now: () => 1_700_000_000_000 })
    await store.actions.init()

    await store.actions.newConversation('web-recorder')
    await store.actions.newConversation('web-recorder')

    const titles = store.getState().readerConversations.map((c) => c.title)
    expect(titles).toContain('Web Reader 1')
    expect(titles).toContain('Web Reader 2')
  })
})
