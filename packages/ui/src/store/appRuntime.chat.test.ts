import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestStore, type TestStore } from '../test/appHarness'
import { createFakeApi, type FakeApi } from '../test/fakeApi'
import type { ClaudeLogEntry, Message } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { DEFAULT_AGENT_POLICY } from '@shared/agentProtocol'

// Быстрые задержки + фейковые таймеры делают мок-пайплайн детерминированным.
const DELAYS = { frame: 20, transcribe: 20, think: 20, speak: 20 }
// STEP строго между одинарной и двойной задержкой: за один сдвиг срабатывает
// ровно одно звено цепочки таймеров (иначе этапы «схлопываются»).
const STEP = 25

function makeStore(seed: string[] = []): { store: TestStore; api: FakeApi } {
  const api = createFakeApi(seed)
  const store = createTestStore({ api, now: () => 1_700_000_000_000, delays: DELAYS })
  return { store, api }
}

describe('voiceStore — интеграция стора с api-моком и машиной состояний', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('init загружает настройки и разговоры, открывает самый свежий', async () => {
    const { store, api } = makeStore(['Первый', 'Второй'])
    const spyGet = vi.spyOn(api, 'settings:get')

    await store.actions.init()

    expect(spyGet).toHaveBeenCalledOnce()
    expect(store.getState().conversations).toHaveLength(2)
    // Самый свежий (последний созданный) — активен, его сообщения загружены.
    expect(store.getState().activeId).toBe(store.getState().conversations[0].id)
    expect(store.getState().voice).toBe('idle')
  })

  it('init с id из адреса открывает именно этот разговор, а не самый свежий', async () => {
    const { store, api } = makeStore(['Первый', 'Второй'])
    const list = await api['conversations:list']({})
    const oldest = list[list.length - 1].id

    await store.actions.init(oldest)

    expect(store.getState().activeId).toBe(oldest)
    // Самый свежий остался первым в списке — открыли не его, а чат из адреса.
    expect(store.getState().conversations[0].id).not.toBe(oldest)
  })

  it('selectConversation возвращает false и показывает ошибку для несуществующего id', async () => {
    const { store } = makeStore(['Первый'])
    await store.actions.init()
    const before = store.getState().activeId

    const ok = await store.actions.selectConversation('нет-такого')

    expect(ok).toBe(false)
    expect(store.getState().error).toMatch(/не найден/)
    expect(store.getState().activeId).toBe(before)
  })

  it('newConversation открывает локальный черновик без серверной записи', async () => {
    const { store, api } = makeStore()
    await store.actions.init()
    const create = vi.spyOn(api, 'conversations:create')
    const id = await store.actions.newConversation()
    expect(id).toBeNull()
    expect(store.getState().activeId).toBeNull()
    expect(store.getState().conversations).toHaveLength(0)
    expect(create).not.toHaveBeenCalled()
  })

  it('повторные новые чаты не персистятся, а потерянный ответ повторяется идемпотентно', async () => {
    const { store, api } = makeStore()
    await store.actions.init()
    await store.actions.newConversation()
    await store.actions.newConversation()
    expect(api._state.conversations).toHaveLength(0)

    const original = api['conversations:createDraft']
    let loseResponse = true
    vi.spyOn(api, 'conversations:createDraft').mockImplementation(async (args) => {
      const result = await original(args)
      if (loseResponse) {
        loseResponse = false
        throw new Error('network lost')
      }
      return result
    })
    store.actions.setDraft('Не потеряй меня')
    await expect(store.actions.submitText()).rejects.toThrow('network lost')
    expect(store.getState().draft).toBe('Не потеряй меня')
    expect(api._state.conversations).toHaveLength(1)

    await expect(store.actions.submitText()).resolves.toBe(true)
    expect(api._state.conversations).toHaveLength(1)
    expect(api._state.messages.filter((message) => message.role === 'u1')).toHaveLength(1)
  })

  it('submitText не сохраняет один черновик дважды при параллельных вызовах', async () => {
    const { store, api } = makeStore()
    await store.actions.init()
    const original = api['conversations:createDraft']
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const createDraft = vi.spyOn(api, 'conversations:createDraft').mockImplementation(async (args) => {
      await gate
      return original(args)
    })

    store.actions.setDraft('Один раз')
    const first = store.actions.submitText()
    const duplicate = store.actions.submitText()

    await expect(duplicate).resolves.toBe(false)
    expect(createDraft).toHaveBeenCalledOnce()
    release()
    await expect(first).resolves.toBe(true)
    expect(api._state.messages.filter((message) => message.role === 'u1' && message.text === 'Один раз')).toHaveLength(1)
  })

  it('обычная отправка остаётся pending до события ленты и резервирует место ответа', async () => {
    const { store } = makeStore()
    await store.actions.init()
    store.actions.setDraft('Подтверди меня')

    await expect(store.actions.submitText()).resolves.toBe(true)
    const message = store.getState().messages.find((item) => item.role === 'u1')!
    expect(store.getState().pendingSubmit?.messageId).toBe(message.id)
    expect(store.getState().preparingReply).toBe(true)

    store.actions.applyChatMessage(message.conversationId, message)
    expect(store.getState().pendingSubmit).toBeNull()
    expect(store.getState().preparingReply).toBe(true)
    store.actions.applyClaudeToken('Ответ', message.conversationId)
    expect(store.getState().preparingReply).toBe(false)
  })

  it('снимает pending, когда chat.message приходит до ответа API', async () => {
    const { store, api } = makeStore(['Чат'])
    await store.actions.init()
    const original = api['messages:add']
    let persisted!: Message
    let firstPersisted!: Message
    let persistedReady!: () => void
    const ready = new Promise<void>((resolve) => { persistedReady = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(api, 'messages:add').mockImplementation(async (args) => {
      persisted = await original(args)
      if (!firstPersisted) firstPersisted = persisted
      persistedReady()
      await gate
      return persisted
    })

    store.actions.setDraft('Раннее подтверждение')
    const sending = store.actions.submitText()
    await ready
    expect(store.getState().pendingSubmit?.messageId).toBeNull()

    store.actions.applyChatMessage(persisted.conversationId, persisted)
    expect(store.getState().pendingSubmit).toBeNull()
    store.actions.setDraft('Следующая реплика')
    const next = store.actions.submitText()
    await vi.advanceTimersByTimeAsync(0)
    expect(api['messages:add']).toHaveBeenCalledTimes(2)

    release()
    await expect(sending).resolves.toBe(true)
    await expect(next).resolves.toBe(true)
    expect(store.getState().messages.filter((message) => message.id === firstPersisted.id)).toHaveLength(1)
  })

  it('во время активного ответа синхронно показывает реплику только в оптимистичной очереди', async () => {
    const { store } = makeStore()
    await store.actions.init()
    store.actions.setDraft('Первый')
    await store.actions.submitText()
    const first = store.getState().messages.find((item) => item.role === 'u1')!
    store.actions.applyChatMessage(first.conversationId, first)

    store.actions.setDraft('Следующий вопрос')
    const sending = store.actions.submitText()
    expect(store.getState().messages.some((item) => item.text === 'Следующий вопрос')).toBe(false)
    expect(store.getState().queuedTurns[first.conversationId]).toEqual([
      expect.objectContaining({ text: 'Следующий вопрос', status: 'queued' })
    ])
    expect(store.getState().pendingSubmit?.queueOnly).toBe(true)

    await expect(sending).resolves.toBe(true)
    const pending = store.getState().pendingSubmit!
    const confirmed = {
      ...store.getState().queuedTurns[first.conversationId]![0],
      id: 'server-q1',
      messageId: pending.messageId!
    }
    store.actions.applyClaudeQueue(first.conversationId, [confirmed], false)
    expect(store.getState().pendingSubmit).toBeNull()
    expect(store.getState().messages.some((item) => item.text === 'Следующий вопрос')).toBe(false)
    expect(store.getState().queuedTurns[first.conversationId]).toEqual([confirmed])
  })

  it('снимает pending по раннему авторитетному claude.queue и сохраняет FIFO', async () => {
    const { store, api } = makeStore(['Чат'])
    await store.actions.init()
    store.actions.setDraft('Первый')
    await store.actions.submitText()
    const first = store.getState().messages.find((item) => item.role === 'u1')!
    store.actions.applyChatMessage(first.conversationId, first)
    store.actions.applyClaudeToken('Ответ', first.conversationId)

    const original = api['messages:add']
    let persisted!: Message
    let persistedReady!: () => void
    const ready = new Promise<void>((resolve) => { persistedReady = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.spyOn(api, 'messages:add').mockImplementation(async (args) => {
      persisted = await original(args)
      persistedReady()
      await gate
      return persisted
    })

    store.actions.setDraft('Второй')
    const sending = store.actions.submitText()
    await ready
    const optimistic = store.getState().queuedTurns[first.conversationId]![0]!
    const confirmed = { ...optimistic, id: 'server-q1', messageId: persisted.id }
    store.actions.applyClaudeQueue(first.conversationId, [confirmed], false)

    expect(store.getState().pendingSubmit).toBeNull()
    expect(store.getState().queuedTurns[first.conversationId]).toEqual([confirmed])
    store.actions.setDraft('Третий')
    const next = store.actions.submitText()
    await vi.advanceTimersByTimeAsync(0)
    expect(api['messages:add']).toHaveBeenCalledTimes(2)

    release()
    await expect(sending).resolves.toBe(true)
    await expect(next).resolves.toBe(true)
    expect(store.getState().queuedTurns[first.conversationId]?.map((item) => item.text)).toEqual(['Второй', 'Третий'])
  })

  it('после каждого подтверждения принимает следующую реплику и сохраняет FIFO', async () => {
    const { store } = makeStore()
    await store.actions.init()
    store.actions.setDraft('Первый')
    await store.actions.submitText()
    const first = store.getState().messages.find((item) => item.role === 'u1')!
    store.actions.applyChatMessage(first.conversationId, first)

    store.actions.setDraft('Второй')
    await expect(store.actions.submitText()).resolves.toBe(true)
    const secondPending = store.getState().pendingSubmit!
    const second = {
      ...store.getState().queuedTurns[first.conversationId]![0]!,
      id: 'server-q1',
      messageId: secondPending.messageId!
    }
    store.actions.applyClaudeQueue(first.conversationId, [second], false)
    expect(store.getState().pendingSubmit).toBeNull()

    store.actions.setDraft('Третий')
    await expect(store.actions.submitText()).resolves.toBe(true)
    const thirdPending = store.getState().pendingSubmit!
    const optimistic = store.getState().queuedTurns[first.conversationId]![1]!
    const third = { ...optimistic, id: 'server-q2', messageId: thirdPending.messageId! }
    store.actions.applyClaudeQueue(first.conversationId, [second, third], false)

    expect(store.getState().pendingSubmit).toBeNull()
    expect(store.getState().queuedTurns[first.conversationId]?.map((item) => item.text)).toEqual(['Второй', 'Третий'])
    expect(store.getState().messages.filter((item) => item.text === 'Второй' || item.text === 'Третий')).toEqual([])
  })

  it('submitText: создаёт разговор, персистит реплику и проходит thinking → speaking → idle', async () => {
    const { store, api } = makeStore()
    const spyAdd = vi.spyOn(api, 'conversations:createDraft')
    await store.actions.init()

    store.actions.setDraft('Привет, Claude')
    await store.actions.submitText()

    // Разговор создан, реплика пользователя записана, черновик очищен, состояние — thinking.
    expect(store.getState().activeId).not.toBeNull()
    expect(spyAdd).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ role: 'u1', text: 'Привет, Claude' }) })
    )
    expect(store.getState().draft).toBe('')
    expect(store.getState().voice).toBe('thinking')

    await vi.advanceTimersByTimeAsync(STEP) // think → speaking + персист ответа ai
    expect(store.getState().voice).toBe('speaking')
    expect(store.getState().messages.some((m) => m.role === 'ai')).toBe(true)

    await vi.advanceTimersByTimeAsync(STEP) // speak → idle
    expect(store.getState().voice).toBe('idle')
  })

  it('submitText сохраняет выбранную DOM-область в meta пользовательской реплики', async () => {
    const { store, api } = makeStore()
    const spyAdd = vi.spyOn(api, 'conversations:createDraft')
    await store.actions.init()
    store.actions.setDraft('Исправь блок')
    const previewElement = { tag: 'div', id: 'hero', classes: [], dataAttributes: {}, selector: '#hero', ancestors: ['html', 'body', 'div#hero'], rect: { x: 0, y: 0, top: 0, right: 320, bottom: 120, left: 0, width: 320, height: 120 }, pageUrl: 'https://example.test', viewport: { width: 800, height: 600 }, outerHTML: '<div id="hero"></div>', text: '', styles: { font: '', color: '', backgroundColor: '', margin: '', padding: '', border: '', width: '', height: '', position: '', display: '', flex: '', flexDirection: '', flexWrap: '', alignItems: '', justifyContent: '', gap: '', grid: '', gridTemplateColumns: '', gridTemplateRows: '', gridArea: '' } }

    expect(await store.actions.submitText(previewElement)).toBe(true)
    expect(spyAdd).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({
        role: 'u1',
        text: 'Исправь блок',
        meta: { previewElement }
      })
    }))
    expect(store.getState().messages[0].meta?.previewElement).toEqual(previewElement)
  })

  it('applyClaudeDone запекает движок в ответ (engine)', async () => {
    const { store, api } = makeStore()
    const spyAdd = vi.spyOn(api, 'messages:add')
    await store.actions.init()

    store.actions.setDraft('Вопрос')
    await store.actions.submitText() // → thinking
    expect(store.getState().voice).toBe('thinking')

    // Ответ пришёл от codex → сообщение сохраняется с engine='codex'.
    await store.actions.applyClaudeDone('Ответ Codex', undefined, 'codex')

    expect(spyAdd).toHaveBeenCalledWith(expect.objectContaining({ role: 'ai', engine: 'codex' }))
    const ai = store.getState().messages.find((m) => m.role === 'ai' && m.text === 'Ответ Codex')
    expect(ai?.engine).toBe('codex')
  })

  it('завершённый ход автоматически меняет статус по режиму запроса', async () => {
    const { store, api } = makeStore(['Чат'])
    const spy = vi.spyOn(api, 'conversations:setStatus')
    await store.actions.init()
    const id = store.getState().activeId!

    await store.actions.applyClaudeDone('', {
      request: { provider: 'claude', model: 'sonnet', prompt: 'план', promptChars: 4, permissionMode: 'plan', resumed: false }
    }, undefined, undefined, id)
    expect(spy).toHaveBeenLastCalledWith({ id, status: 'planning_done' })
    expect(store.getState().conversations.find((c) => c.id === id)?.status).toBe('planning_done')

    await store.actions.applyClaudeDone('', {
      request: { provider: 'claude', model: 'sonnet', prompt: 'код', promptChars: 3, permissionMode: 'acceptEdits', resumed: true }
    }, undefined, undefined, id)
    expect(spy).toHaveBeenLastCalledWith({ id, status: 'development_done' })
    expect(store.getState().conversations.find((c) => c.id === id)?.status).toBe('development_done')
  })

  it('пустой черновик не отправляется', async () => {
    const { store, api } = makeStore()
    const spyAdd = vi.spyOn(api, 'messages:add')
    await store.actions.init()

    store.actions.setDraft('   ')
    await store.actions.submitText()

    expect(spyAdd).not.toHaveBeenCalled()
    expect(store.getState().voice).toBe('idle')
  })

  it('голосовой цикл: startVoice растит транскрипт, stopVoice ведёт через transcribing → thinking → speaking → idle', async () => {
    const { store } = makeStore(['Разговор'])
    await store.actions.init()

    store.actions.startVoice()
    expect(store.getState().voice).toBe('listening')
    expect(store.getState().liveSegments.length).toBeGreaterThan(0)

    const firstLen = store.getState().liveSegments[0].text.length
    await vi.advanceTimersByTimeAsync(STEP) // следующий кадр транскрипта
    expect(store.getState().liveSegments[0].text.length).toBeGreaterThan(firstLen)

    store.actions.stopVoice()
    expect(store.getState().voice).toBe('transcribing')

    await vi.advanceTimersByTimeAsync(STEP) // transcribe → thinking (+ персист реплик)
    expect(store.getState().voice).toBe('thinking')
    expect(store.getState().liveSegments).toHaveLength(0)
    expect(store.getState().messages.some((m) => m.role.startsWith('u'))).toBe(true)

    await vi.advanceTimersByTimeAsync(STEP) // think → speaking
    expect(store.getState().voice).toBe('speaking')

    await vi.advanceTimersByTimeAsync(STEP) // speak → idle
    expect(store.getState().voice).toBe('idle')
  })

  it('глобальная блокировка не позволяет запустить запись', () => {
    const store = createTestStore({ api: createFakeApi([]), voiceInputEnabled: false })
    store.actions.startVoice()
    expect(store.getState().voice).toBe('idle')
  })

  it('barge-in: нажатие микрофона во время speaking возвращает в listening', async () => {
    const { store } = makeStore()
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    await vi.advanceTimersByTimeAsync(STEP) // → speaking
    expect(store.getState().voice).toBe('speaking')

    store.actions.startVoice() // barge-in
    expect(store.getState().voice).toBe('listening')
  })

  it('недопустимый переход игнорируется (stopVoice из idle)', async () => {
    const { store } = makeStore()
    await store.actions.init()
    store.actions.stopVoice()
    expect(store.getState().voice).toBe('idle')
  })

  it('updateSettings сохраняет настройки через api и обновляет состояние', async () => {
    const { store, api } = makeStore()
    const spySave = vi.spyOn(api, 'settings:save')
    await store.actions.init()

    await store.actions.updateSettings({ diarization: false })

    expect(store.getState().settings.diarization).toBe(false)
    expect(spySave).toHaveBeenCalledWith(expect.objectContaining({ diarization: false }))
    expect(api._state.settings.diarization).toBe(false)
  })

  it('deleteConversation активного переключает на оставшийся', async () => {
    const { store } = makeStore(['A', 'B'])
    await store.actions.init()
    const activeId = store.getState().activeId as string

    await store.actions.deleteConversation(activeId)

    expect(store.getState().conversations).toHaveLength(1)
    expect(store.getState().activeId).not.toBe(activeId)
    expect(store.getState().activeId).not.toBeNull()
  })

  it('newConversation сбрасывает активный разговор и состояние', async () => {
    const { store } = makeStore(['A'])
    await store.actions.init()
    expect(store.getState().activeId).not.toBeNull()

    await store.actions.newConversation()

    expect(store.getState().activeId).toBeNull()
    expect(store.getState().conversations).toHaveLength(1)
    expect(store.getState().messages).toHaveLength(0)
    expect(store.getState().voice).toBe('idle')
  })

  it('applyAgents обновляет живой список машин', () => {
    const { store } = makeStore()
    store.actions.applyAgents([
      {
        id: 'a1',
        name: 'Mac',
        online: true,
        createdAt: 1,
        lastSeen: 2,
        policy: {
          allowedDirs: [],
          allowNetwork: true,
          allowWrite: true,
          denyPatterns: [],
          allowPatterns: [],
          skills: []
        }
      }
    ])
    expect(store.getState().agents).toHaveLength(1)
    expect(store.getState().agents[0].online).toBe(true)
  })

  it('setAgentPolicy зовёт канал и обновляет локальный список', async () => {
    const { store, api } = makeStore()
    const spy = vi.spyOn(api, 'agents:setPolicy')
    store.actions.applyAgents([
      {
        id: 'a1',
        name: 'Mac',
        online: true,
        createdAt: 1,
        lastSeen: 2,
        policy: {
          allowedDirs: [],
          allowNetwork: true,
          allowWrite: true,
          denyPatterns: [],
          allowPatterns: [],
          skills: []
        }
      }
    ])
    const policy = {
      allowedDirs: ['/tmp'],
      allowNetwork: false,
      allowWrite: true,
      denyPatterns: [],
      allowPatterns: [],
      skills: []
    }
    await store.actions.setAgentPolicy('a1', policy)
    expect(spy).toHaveBeenCalledWith({ id: 'a1', policy })
    expect(store.getState().agents[0].policy.allowNetwork).toBe(false)
  })

  it('deleteAgent снимает удалённую машину с дефолта, цели настроек и разговора', async () => {
    const { store } = makeStore(['Первый'])
    await store.actions.init()
    const created = await store.actions.createAgent('Mac')
    expect(created).not.toBeNull()
    const id = created!.id
    const convId = store.getState().activeId!
    await store.actions.setConversationExecTarget(convId, id)
    await store.actions.updateSettings({ execTarget: id, defaultAgentId: id })

    await store.actions.deleteAgent(id)

    // Висячий id увёл бы следующий ход на машину, которой больше нет, поэтому
    // проверяем все три ссылки сразу.
    expect(store.getState().agents.some((a) => a.id === id)).toBe(false)
    expect(store.getState().settings.execTarget).toBeNull()
    expect(store.getState().settings.defaultAgentId).toBeNull()
    expect(store.getState().conversations.find((c) => c.id === convId)?.execTarget).toBeNull()
  })

  it('deleteAgent при ошибке канала показывает тост и не выкидывает исключение', async () => {
    const { store, api } = makeStore()
    await store.actions.init()
    const created = await store.actions.createAgent('Mac')
    vi.spyOn(api, 'agents:delete').mockRejectedValue(new Error('HTTP 500'))

    await store.actions.deleteAgent(created!.id)

    expect(store.getState().notices.at(-1)?.text).toMatch(/HTTP 500/)
    // Машина осталась: сервер её не удалил, и список врать не должен.
    expect(store.getState().agents.some((a) => a.id === created!.id)).toBe(true)
  })

  it('init грузит список MCP-серверов', async () => {
    const api = createFakeApi([])
    vi.spyOn(api, 'mcp:list').mockResolvedValue([
      { name: 'fs', detail: 'npx server', status: '✓ Connected', connected: true }
    ])
    const store = createTestStore({ api, now: () => 1, delays: DELAYS })
    await store.actions.init()
    expect(store.getState().mcpServers).toEqual([
      { name: 'fs', detail: 'npx server', status: '✓ Connected', connected: true }
    ])
  })

  it('renameConversation сохраняет новое имя и обновляет список', async () => {
    const { store, api } = makeStore(['Старое'])
    await store.actions.init()
    const id = store.getState().conversations[0].id
    const spy = vi.spyOn(api, 'conversations:rename')

    await store.actions.renameConversation(id, '  Новое имя  ')

    expect(spy).toHaveBeenCalledWith({ id, title: 'Новое имя' }) // trim
    expect(store.getState().conversations[0].title).toBe('Новое имя')
  })

  it('renameConversation игнорирует пустое имя', async () => {
    const { store, api } = makeStore(['Старое'])
    await store.actions.init()
    const id = store.getState().conversations[0].id
    const spy = vi.spyOn(api, 'conversations:rename')

    await store.actions.renameConversation(id, '   ')

    expect(spy).not.toHaveBeenCalled()
    expect(store.getState().conversations[0].title).toBe('Старое')
  })

  it('setSearchQuery фильтрует список; пустой запрос возвращает все', async () => {
    const { store } = makeStore(['Лиссабон', 'Рецепты', 'Погода'])
    await store.actions.init()
    expect(store.getState().conversations).toHaveLength(3)

    await store.actions.setSearchQuery('рецеп')
    expect(store.getState().searchQuery).toBe('рецеп')
    expect(store.getState().conversations.map((c) => c.title)).toEqual(['Рецепты'])

    await store.actions.setSearchQuery('')
    expect(store.getState().conversations).toHaveLength(3)
  })

  it('exportConversation зовёт download с корректными именем/mime/содержимым', async () => {
    const download = vi.fn()
    const api = createFakeApi(['Лиссабон'])
    const store = createTestStore({ api, now: () => 1_700_000_000_000, delays: DELAYS, download })
    await store.actions.init()
    await store.actions.selectConversation(store.getState().conversations[0].id)
    store.actions.setDraft('Привет')
    // положим одно сообщение через submitText (мок-режим)
    await store.actions.submitText()

    store.actions.exportConversation('md')
    expect(download).toHaveBeenCalledTimes(1)
    const [name, mime, data] = download.mock.calls[0]
    expect(name).toBe('лиссабон.md')
    expect(mime).toBe('text/markdown')
    expect(data).toContain('# Лиссабон')

    store.actions.exportConversation('json')
    const [nameJ, mimeJ] = download.mock.calls[1]
    expect(nameJ).toBe('лиссабон.json')
    expect(mimeJ).toBe('application/json')
  })
})

describe('voiceStore — интеграция с аудиозахватом (Шаг 6)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('init загружает список микрофонов из listMics', async () => {
    const api = createFakeApi([])
    const listMics = vi.fn().mockResolvedValue([{ deviceId: 'mic-a', label: 'Микрофон A' }])
    const store = createTestStore({ api, delays: DELAYS, listMics })

    await store.actions.init()

    expect(listMics).toHaveBeenCalled()
    expect(store.getState().mics).toEqual([{ deviceId: 'mic-a', label: 'Микрофон A' }])
  })

  it('startVoice запускает захват с выбранным устройством, stopVoice — останавливает', async () => {
    const api = createFakeApi([])
    const audio = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }
    const store = createTestStore({ api, delays: DELAYS, audio })
    await store.actions.init()
    await store.actions.updateSettings({ micDeviceId: 'mic-x' })

    store.actions.startVoice()
    expect(store.getState().voice).toBe('listening')
    expect(audio.start).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'mic-x' })
    )

    store.actions.stopVoice()
    expect(audio.stop).toHaveBeenCalledOnce()
  })

  it('без audio-контроллера голосовой цикл работает (запись пропускается)', async () => {
    const { store } = makeStore()
    await store.actions.init()
    expect(() => store.actions.startVoice()).not.toThrow()
    expect(store.getState().voice).toBe('listening')
  })
})

describe('voiceStore — реальный STT (sttEnabled)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  function makeSttStore(): TestStore {
    const api = createFakeApi([])
    return createTestStore({ api, delays: DELAYS, sttEnabled: true })
  }

  it('startVoice не запускает мок-транскрипт; partial наполняет live-блок', async () => {
    const store = makeSttStore()
    await store.actions.init()

    store.actions.startVoice()
    expect(store.getState().voice).toBe('listening')
    // Без реального STT кадры мок-транскрипта не появляются сами.
    await vi.advanceTimersByTimeAsync(STEP)
    expect(store.getState().liveSegments).toHaveLength(0)

    store.actions.applySttPartial({ segments: [{ speakerId: 1, text: 'привет' }], text: 'привет' })
    expect(store.getState().liveSegments).toEqual([{ speakerId: 1, text: 'привет' }])
  })

  it('полный цикл: stopVoice ждёт финал, applySttFinal ведёт thinking → speaking → idle', async () => {
    const store = makeSttStore()
    await store.actions.init()
    store.actions.startVoice()
    store.actions.applySttPartial({ segments: [{ speakerId: 1, text: 'как дела' }], text: 'как дела' })

    store.actions.stopVoice()
    expect(store.getState().voice).toBe('transcribing') // ждём stt:final, мок-таймер не запущен
    await vi.advanceTimersByTimeAsync(STEP)
    expect(store.getState().voice).toBe('transcribing')

    await store.actions.applySttFinal({
      segments: [{ speakerId: 1, text: 'Как дела?' }],
      text: 'Как дела?'
    })
    expect(store.getState().voice).toBe('thinking')
    expect(store.getState().messages.some((m) => m.text === 'Как дела?' && m.role === 'u1')).toBe(
      true
    )

    await vi.advanceTimersByTimeAsync(STEP) // think → speaking
    expect(store.getState().voice).toBe('speaking')
    await vi.advanceTimersByTimeAsync(STEP) // speak → idle
    expect(store.getState().voice).toBe('idle')
  })

  it('пишет тайминг распознавания в консоль (при showConsole)', async () => {
    const store = makeSttStore()
    await store.actions.init()
    await store.actions.updateSettings({ showConsole: true })
    store.actions.startVoice()
    store.actions.stopVoice() // засекает распознавание
    await vi.advanceTimersByTimeAsync(1500) // «распознавание» 1.5 с
    await store.actions.applySttFinal({
      segments: [{ speakerId: 1, text: 'Привет' }],
      text: 'Привет'
    })
    const entry = store.getState().consoleLog.find((e) => e.kind === 'stt')
    expect(entry).toBeTruthy()
    expect(entry?.summary).toContain('Распознавание речи')
    expect(entry?.summary).toContain('1.5 с')
  })

  it('без showConsole тайминг STT не пишется', async () => {
    const store = makeSttStore()
    await store.actions.init()
    store.actions.startVoice()
    store.actions.stopVoice()
    await store.actions.applySttFinal({ segments: [{ speakerId: 1, text: 'x' }], text: 'x' })
    expect(store.getState().consoleLog.some((e) => e.kind === 'stt')).toBe(false)
  })

  it('пустой финал возвращает в idle без сообщений', async () => {
    const store = makeSttStore()
    await store.actions.init()
    store.actions.startVoice()
    store.actions.stopVoice()
    await store.actions.applySttFinal({ segments: [], text: '' })
    expect(store.getState().voice).toBe('idle')
    expect(store.getState().messages).toHaveLength(0)
  })

  it('applySttError возвращает в idle из listening', async () => {
    const store = makeSttStore()
    await store.actions.init()
    store.actions.startVoice()
    expect(store.getState().voice).toBe('listening')
    store.actions.applySttError('нет модели')
    expect(store.getState().voice).toBe('idle')
    expect(store.getState().liveSegments).toHaveLength(0)
  })
})

describe('voiceStore — реальный Claude (claudeEnabled)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  function makeClaudeStore(): {
    store: TestStore
    sendClaudePrompt: ReturnType<typeof vi.fn>
    cancelClaude: ReturnType<typeof vi.fn>
  } {
    const api = createFakeApi([])
    const sendClaudePrompt = vi.fn()
    const cancelClaude = vi.fn()
    const store = createTestStore({
      api,
      delays: DELAYS,
      claudeEnabled: true,
      sendClaudePrompt,
      cancelClaude
    })
    return { store, sendClaudePrompt, cancelClaude }
  }

  it('submitText отправляет сегменты в Claude и НЕ запускает мок-ответ', async () => {
    const { store, sendClaudePrompt } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('Привет')
    await store.actions.submitText()

    expect(store.getState().voice).toBe('thinking')
    const activeId = store.getState().activeId as string
    expect(sendClaudePrompt).toHaveBeenCalledWith(
      activeId,
      [{ speakerId: 1, text: 'Привет' }],
      [],
      true // verbose всегда true: активность нужна для статуса и подробного вида
    )

    await vi.advanceTimersByTimeAsync(STEP) // мок-ответ не должен появиться
    expect(store.getState().voice).toBe('thinking')
    expect(store.getState().messages.some((m) => m.role === 'ai')).toBe(false)
  })

  it('токены растят streamingReply, done фиксирует сообщение и ведёт speaking → idle', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()

    store.actions.applyClaudeToken('При')
    store.actions.applyClaudeToken('вет')
    expect(store.getState().streamingReply).toBe('Привет')

    store.actions.applyClaudeDone('Привет')
    // finishReply асинхронный (persist) — дождёмся микротасков.
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().streamingReply).toBe('')
    expect(store.getState().messages.some((m) => m.role === 'ai' && m.text === 'Привет')).toBe(true)
    expect(store.getState().voice).toBe('speaking')

    await vi.advanceTimersByTimeAsync(STEP) // speak → idle
    expect(store.getState().voice).toBe('idle')
  })

  it('applyClaudeDone сохраняет мету хода в lastTurnMeta', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('x')
    await store.actions.submitText()
    store.actions.applyClaudeToken('Ответ')
    store.actions.applyClaudeDone('Ответ', { durationMs: 3000, numTurns: 1, costUsd: 0.01 })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().lastTurnMeta).toEqual({ durationMs: 3000, numTurns: 1, costUsd: 0.01 })
  })

  it('done с пустым текстом использует накопленный стрим', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('x')
    await store.actions.submitText()
    store.actions.applyClaudeToken('Ответ')
    store.actions.applyClaudeDone('')
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().messages.some((m) => m.text === 'Ответ')).toBe(true)
  })

  it('applyClaudeError показывает баннер и возвращает в idle', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('x')
    await store.actions.submitText()
    expect(store.getState().pendingSubmit).not.toBeNull()
    expect(store.getState().preparingReply).toBe(true)
    store.actions.applyClaudeError('Claude CLI не найден')
    expect(store.getState().voice).toBe('idle')
    expect(store.getState().error).toBe('Claude CLI не найден')
    expect(store.getState().pendingSubmit).toBeNull()
    expect(store.getState().preparingReply).toBe(false)

    store.actions.dismissError()
    expect(store.getState().error).toBeNull()
  })
})

describe('voiceStore — barge-in голосом (VAD)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  async function speakingStore(bargeIn: boolean): Promise<TestStore> {
    const api = createFakeApi([])
    const store = createTestStore({
      api,
      delays: DELAYS,
      claudeEnabled: true,
      sendClaudePrompt: vi.fn()
    })
    await store.actions.init()
    await store.actions.updateSettings({ bargeIn })
    store.actions.setDraft('x')
    await store.actions.submitText()
    store.actions.applyClaudeToken('ответ')
    store.actions.applyClaudeDone('ответ')
    await vi.advanceTimersByTimeAsync(0)
    return store
  }

  it('речь во время озвучки прерывает её и начинает запись (bargeIn)', async () => {
    const store = await speakingStore(true)
    expect(store.getState().voice).toBe('speaking')
    store.actions.applyMicEnergy(0.5)
    store.actions.applyMicEnergy(0.5)
    store.actions.applyMicEnergy(0.5) // 3 громких кадра → speech-start
    expect(store.getState().voice).toBe('listening')
  })

  it('без bargeIn энергия микрофона игнорируется', async () => {
    const store = await speakingStore(false)
    expect(store.getState().voice).toBe('speaking')
    store.actions.applyMicEnergy(0.5)
    store.actions.applyMicEnergy(0.5)
    store.actions.applyMicEnergy(0.5)
    expect(store.getState().voice).toBe('speaking')
  })
})

describe('voiceStore — hands-free (VAD авто-пауза + авто-старт)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('в listening пауза после речи авто-финализирует запись (speech-end → stopVoice)', async () => {
    const api = createFakeApi([])
    const store = createTestStore({ api, delays: DELAYS })
    await store.actions.init()
    await store.actions.updateSettings({ handsFree: true })
    store.actions.startVoice()
    expect(store.getState().voice).toBe('listening')

    // Речь (3 громких кадра) → затем тишина (8 тихих) → speech-end → stopVoice.
    for (let i = 0; i < 3; i++) store.actions.applyMicEnergy(0.5)
    for (let i = 0; i < 8; i++) store.actions.applyMicEnergy(0)
    expect(store.getState().voice).toBe('transcribing')
  })

  it('без handsFree тишина не останавливает запись', async () => {
    const api = createFakeApi([])
    const store = createTestStore({ api, delays: DELAYS })
    await store.actions.init()
    store.actions.startVoice()
    for (let i = 0; i < 3; i++) store.actions.applyMicEnergy(0.5)
    for (let i = 0; i < 10; i++) store.actions.applyMicEnergy(0)
    expect(store.getState().voice).toBe('listening')
  })

  it('после ответа (speaking → idle) hands-free авто-стартует запись', async () => {
    const api = createFakeApi([])
    const store = createTestStore({
      api,
      delays: DELAYS,
      claudeEnabled: true,
      sendClaudePrompt: vi.fn()
    })
    await store.actions.init()
    await store.actions.updateSettings({ handsFree: true })
    store.actions.setDraft('x')
    await store.actions.submitText()
    store.actions.applyClaudeToken('ответ')
    store.actions.applyClaudeDone('ответ')
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().voice).toBe('speaking')
    await vi.advanceTimersByTimeAsync(STEP) // speaking → idle (мок-таймер)
    // Пауза перед авто-стартом.
    await vi.advanceTimersByTimeAsync(500)
    expect(store.getState().voice).toBe('listening')
  })
})

describe('voiceStore — Проводник Claude Code', () => {
  it('openObserver грузит проекты; выбор проекта → сессии; сессии → транскрипт + tail', async () => {
    const api = createFakeApi([])
    vi.spyOn(api, 'cc:projects').mockResolvedValue([
      { slug: '-U-x-a', path: '/U/x/a', name: 'a', sessionCount: 2, lastActivity: 2 }
    ])
    vi.spyOn(api, 'cc:sessions').mockResolvedValue([
      { id: 's1', title: 'Первая', updatedAt: 2, sizeBytes: 10 }
    ])
    vi.spyOn(api, 'cc:transcript').mockResolvedValue({ items: [{ kind: 'user', text: 'Привет' }], usage: {} })
    const ccTailStart = vi.fn()
    const ccTailStop = vi.fn()
    const store = createTestStore({ api, now: () => 1, ccTailStart, ccTailStop })

    await store.actions.openObserver()
    expect(store.getState().ccOpen).toBe(true)
    expect(store.getState().ccProjects).toHaveLength(1)

    await store.actions.selectCcProject('-U-x-a')
    expect(store.getState().ccSessions.map((s) => s.title)).toEqual(['Первая'])

    await store.actions.selectCcSession('-U-x-a', 's1')
    expect(store.getState().ccTranscript.map((i) => i.text)).toEqual(['Привет'])
    expect(ccTailStart).toHaveBeenCalledWith('-U-x-a', 's1')

    store.actions.applyCcTailItems([{ kind: 'assistant', text: 'Ответ' }])
    expect(store.getState().ccTranscript.map((i) => i.text)).toEqual(['Привет', 'Ответ'])

    store.actions.closeObserver()
    expect(store.getState().ccOpen).toBe(false)
    expect(ccTailStop).toHaveBeenCalled()
  })
})

describe('voiceStore — режим консоли (activity log)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  const entry = (summary: string): ClaudeLogEntry => ({
    kind: 'tool_use',
    summary,
    raw: `{"summary":"${summary}"}`
  })

  it('applyClaudeLog добавляет записи в consoleLog по порядку', () => {
    const api = createFakeApi([])
    const store = createTestStore({ api, delays: DELAYS })
    store.actions.applyClaudeLog(entry('Bash: ls'))
    store.actions.applyClaudeLog(entry('Read: index.ts'))
    expect(store.getState().consoleLog.map((e) => e.summary)).toEqual(['Bash: ls', 'Read: index.ts'])
  })

  it('toggleConsole переключает признак развёрнутости панели', () => {
    const api = createFakeApi([])
    const store = createTestStore({ api, delays: DELAYS })
    const initial = store.getState().consoleOpen
    store.actions.toggleConsole()
    expect(store.getState().consoleOpen).toBe(!initial)
    store.actions.toggleConsole()
    expect(store.getState().consoleOpen).toBe(initial)
  })

  it('submitText передаёт verbose=true в Claude всегда (активность нужна для статуса)', async () => {
    const api = createFakeApi([])
    const sendClaudePrompt = vi.fn()
    const store = createTestStore({
      api,
      delays: DELAYS,
      claudeEnabled: true,
      sendClaudePrompt
    })
    await store.actions.init()
    // showConsole выключен — verbose всё равно true (для живого статуса/подробного вида).
    store.actions.setDraft('вопрос')
    await store.actions.submitText()

    const activeId = store.getState().activeId as string
    expect(sendClaudePrompt).toHaveBeenCalledWith(
      activeId,
      [{ speakerId: 1, text: 'вопрос' }],
      [],
      true
    )
  })

  it('consoleLog очищается при смене/создании разговора', async () => {
    const { store } = makeStore(['A', 'B'])
    await store.actions.init()
    store.actions.applyClaudeLog(entry('Bash: ls'))
    expect(store.getState().consoleLog.length).toBe(1)

    const other = store.getState().conversations.find((c) => c.id !== store.getState().activeId)!
    await store.actions.selectConversation(other.id)
    expect(store.getState().consoleLog).toEqual([])

    store.actions.applyClaudeLog(entry('Read: x'))
    await store.actions.newConversation()
    expect(store.getState().consoleLog).toEqual([])
  })

  it('applyClaudeLog копит liveActivity только для активного разговора', async () => {
    const { store } = makeStore(['A'])
    await store.actions.init()
    const activeId = store.getState().activeId as string
    store.actions.applyClaudeLog(entry('Bash: ls'), activeId)
    store.actions.applyClaudeLog(entry('чужой ход'), 'other-conv')
    // В liveActivity — только запись активного разговора; в общий лог — обе.
    expect(store.getState().liveActivity.map((e) => e.summary)).toEqual(['Bash: ls'])
    expect(store.getState().consoleLog.length).toBe(2)
  })

  it('applyClaudeDone очищает liveActivity активного разговора', async () => {
    const { store } = makeStore(['A'])
    await store.actions.init()
    const activeId = store.getState().activeId as string
    store.actions.applyClaudeLog(entry('Bash: ls'), activeId)
    expect(store.getState().liveActivity.length).toBe(1)
    store.actions.applyClaudeDone('', undefined, undefined, undefined, activeId)
    expect(store.getState().liveActivity).toEqual([])
  })

  it('liveActivity очищается при смене разговора', async () => {
    const { store } = makeStore(['A', 'B'])
    await store.actions.init()
    const activeId = store.getState().activeId as string
    store.actions.applyClaudeLog(entry('Bash: ls'), activeId)
    expect(store.getState().liveActivity.length).toBe(1)
    const other = store.getState().conversations.find((c) => c.id !== activeId)!
    await store.actions.selectConversation(other.id)
    expect(store.getState().liveActivity).toEqual([])
  })
})

describe('voiceStore — статус и скачивание модели (Шаг 9)', () => {
  it('init выставляет modelPresent из getSttStatus', async () => {
    const api = createFakeApi([])
    const getSttStatus = vi.fn().mockResolvedValue({ present: false, model: 'large-v3-turbo' })
    const store = createTestStore({ api, getSttStatus })
    await store.actions.init()
    expect(getSttStatus).toHaveBeenCalled()
    expect(store.getState().modelPresent).toBe(false)
  })

  it('downloadModel запускает загрузку; прогресс и done обновляют состояние', async () => {
    const api = createFakeApi([])
    const startModelDownload = vi.fn()
    const store = createTestStore({
      api,
      startModelDownload,
      getSttStatus: async () => ({ present: false, model: 'large-v3-turbo' })
    })
    await store.actions.init()

    store.actions.downloadModel()
    expect(startModelDownload).toHaveBeenCalledOnce()
    expect(store.getState().downloading).toBe(true)

    store.actions.applyDownloadProgress(42)
    expect(store.getState().downloadPercent).toBe(42)

    store.actions.applyDownloadDone()
    expect(store.getState().downloading).toBe(false)
    expect(store.getState().downloadPercent).toBe(100)
    expect(store.getState().modelPresent).toBe(true)
  })

  it('applyDownloadError снимает флаг и показывает ошибку', async () => {
    const api = createFakeApi([])
    const store = createTestStore({
      api,
      startModelDownload: vi.fn(),
      getSttStatus: async () => ({ present: false, model: 'small' })
    })
    await store.actions.init()
    store.actions.downloadModel()
    store.actions.applyDownloadError('сеть недоступна')
    expect(store.getState().downloading).toBe(false)
    expect(store.getState().error).toBe('сеть недоступна')
  })

  it('init грузит каталог голосов', async () => {
    const api = createFakeApi([])
    const store = createTestStore({ api })
    await store.actions.init()
    expect(store.getState().voicesDownloadable).toBe(true)
    expect(store.getState().voiceCatalog.length).toBeGreaterThan(0)
  })

  it('downloadVoice запускает загрузку; прогресс/done обновляют состояние', async () => {
    const api = createFakeApi([])
    const startVoiceDownload = vi.fn()
    const store = createTestStore({ api, startVoiceDownload })
    await store.actions.init()

    store.actions.downloadVoice('ru_RU-ruslan-medium')
    expect(startVoiceDownload).toHaveBeenCalledWith('ru_RU-ruslan-medium')
    expect(store.getState().voiceDownloads['ru_RU-ruslan-medium']).toBe(0)

    store.actions.applyVoiceProgress('ru_RU-ruslan-medium', 55)
    expect(store.getState().voiceDownloads['ru_RU-ruslan-medium']).toBe(55)

    await store.actions.applyVoiceDone('ru_RU-ruslan-medium')
    expect('ru_RU-ruslan-medium' in store.getState().voiceDownloads).toBe(false)
  })

  it('applyVoiceError снимает прогресс и показывает ошибку', async () => {
    const api = createFakeApi([])
    const store = createTestStore({ api, startVoiceDownload: vi.fn() })
    await store.actions.init()
    store.actions.downloadVoice('ru_RU-ruslan-medium')
    store.actions.applyVoiceError('ru_RU-ruslan-medium', 'нет сети')
    expect('ru_RU-ruslan-medium' in store.getState().voiceDownloads).toBe(false)
    expect(store.getState().error).toBe('нет сети')
  })
})

describe('voiceStore — TTS (ttsEnabled, Шаг 10)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  function makeTtsStore(): {
    store: TestStore
    speakText: ReturnType<typeof vi.fn>
    cancelTts: ReturnType<typeof vi.fn>
  } {
    const api = createFakeApi([])
    api._state.settings.autoSpeak = true // автоозвучка для проверки TTS-пайплайна
    const speakText = vi.fn()
    const cancelTts = vi.fn()
    const store = createTestStore({ api, delays: DELAYS, ttsEnabled: true, speakText, cancelTts })
    return { store, speakText, cancelTts }
  }

  async function reachSpeaking(store: TestStore): Promise<void> {
    await store.actions.init()
    store.actions.setDraft('привет')
    await store.actions.submitText()
    await vi.advanceTimersByTimeAsync(STEP) // think → speaking (мок-ответ)
  }

  it('speaking ведётся через TTS (без мок-таймера); applyTtsDone завершает', async () => {
    const { store, speakText } = makeTtsStore()
    await reachSpeaking(store)

    expect(store.getState().voice).toBe('speaking')
    // Сохранённого голоса нет среди голосов движка — синтез идёт доступным,
    // но саму настройку это не переписывает (её вернёт скачанный голос).
    expect(speakText).toHaveBeenCalledWith(expect.any(String), 'ru_RU-irina-medium')
    expect(store.getState().settings.voice).toBe(DEFAULT_SETTINGS.voice)

    // Сам не уходит из speaking — ждём tts:done.
    await vi.advanceTimersByTimeAsync(STEP)
    expect(store.getState().voice).toBe('speaking')

    store.actions.applyTtsDone()
    expect(store.getState().voice).toBe('idle')
  })

  it('stopSpeak прерывает озвучку и уходит в idle', async () => {
    const { store, cancelTts } = makeTtsStore()
    await reachSpeaking(store)
    store.actions.stopSpeak()
    expect(store.getState().voice).toBe('idle')
    expect(cancelTts).toHaveBeenCalled()
  })

  it('applyTtsError не застревает в speaking', async () => {
    const { store } = makeTtsStore()
    await reachSpeaking(store)
    store.actions.applyTtsError('нет голоса')
    expect(store.getState().voice).toBe('idle')
  })

  it('пишет тайминг генерации речи в консоль (при showConsole)', async () => {
    const { store } = makeTtsStore()
    await store.actions.init()
    await store.actions.updateSettings({ showConsole: true })
    store.actions.setDraft('привет')
    await store.actions.submitText()
    await vi.advanceTimersByTimeAsync(STEP) // → speaking, запрошен синтез (ttsReqAt)
    await vi.advanceTimersByTimeAsync(300) // «генерация» 0.3 с
    store.actions.applyTtsAudioReceived() // пришло аудио
    const entry = store.getState().consoleLog.find((e) => e.kind === 'tts')
    expect(entry).toBeTruthy()
    expect(entry?.summary).toContain('Генерация речи')
  })
})

describe('voiceStore — стриминговая озвучка Claude + кнопка озвучки', () => {
  function makeStreamStore(): {
    store: TestStore
    speakText: ReturnType<typeof vi.fn>
    cancelTts: ReturnType<typeof vi.fn>
  } {
    const api = createFakeApi([])
    api._state.settings.autoSpeak = true // автоозвучка для проверки стриминга TTS
    const speakText = vi.fn()
    const cancelTts = vi.fn()
    const store = createTestStore({
      api,
      delays: DELAYS,
      claudeEnabled: true,
      sendClaudePrompt: vi.fn(),
      cancelClaude: vi.fn(),
      ttsEnabled: true,
      speakText,
      cancelTts
    })
    return { store, speakText, cancelTts }
  }

  it('озвучивает по предложениям на лету; speaking стартует до конца ответа', async () => {
    const { store, speakText } = makeStreamStore()
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    expect(store.getState().voice).toBe('thinking')

    store.actions.applyClaudeToken('Привет. ')
    expect(speakText).toHaveBeenCalledWith('Привет.', expect.any(String))
    expect(store.getState().voice).toBe('speaking') // стартовали до конца ответа

    store.actions.applyClaudeToken('Как дела?')
    expect(speakText).toHaveBeenCalledTimes(2)

    await store.actions.applyClaudeDone('Привет. Как дела?')
    expect(store.getState().messages.some((m) => m.role === 'ai')).toBe(true)
    expect(store.getState().voice).toBe('speaking') // ждём проигрывания клипов

    store.actions.applyTtsDone()
    store.actions.applyTtsDone()
    expect(store.getState().voice).toBe('idle')
  })

  it('блок кода не озвучивается — вместо него фраза «пример кода»', async () => {
    const { store, speakText } = makeStreamStore()
    await store.actions.init()
    store.actions.setDraft('код')
    await store.actions.submitText()

    store.actions.applyClaudeToken('Вот пример:\n```js\nconst x = 1\n')
    store.actions.applyClaudeToken('```\nГотово.')
    await store.actions.applyClaudeDone('Вот пример:\n```js\nconst x = 1\n```\nГотово.')

    const spoken = speakText.mock.calls.map((c) => c[0])
    expect(spoken.some((t) => t.includes('Далее пример кода'))).toBe(true)
    expect(spoken.some((t) => t.includes('const x'))).toBe(false) // код не озвучен
    expect(spoken.some((t) => t.includes('Готово'))).toBe(true)
  })

  it('короткий ответ без границ озвучивается на финале', async () => {
    const { store, speakText } = makeStreamStore()
    await store.actions.init()
    store.actions.setDraft('x')
    await store.actions.submitText()
    store.actions.applyClaudeToken('Да')
    expect(speakText).not.toHaveBeenCalled() // нет границы предложения
    await store.actions.applyClaudeDone('Да')
    expect(speakText).toHaveBeenCalledWith('Да', expect.any(String))
    expect(store.getState().voice).toBe('speaking')
    store.actions.applyTtsDone()
    expect(store.getState().voice).toBe('idle')
  })

  it('replayMessage озвучивает сообщение и toggle останавливает', async () => {
    const { store, speakText, cancelTts } = makeStreamStore()
    await store.actions.init()

    store.actions.replayMessage('m1', 'Один. Два.')
    expect(store.getState().speakingMessageId).toBe('m1')
    expect(speakText).toHaveBeenCalledTimes(2) // два предложения
    expect(store.getState().voice).toBe('idle') // вне машины состояний

    store.actions.replayMessage('m1', 'Один. Два.') // toggle
    expect(store.getState().speakingMessageId).toBeNull()
    expect(cancelTts).toHaveBeenCalled()
  })

  it('replay завершается по проигрыванию всех клипов', async () => {
    const { store } = makeStreamStore()
    await store.actions.init()
    store.actions.replayMessage('m2', 'Раз. Два.')
    expect(store.getState().speakingMessageId).toBe('m2')
    store.actions.applyTtsDone()
    store.actions.applyTtsDone()
    expect(store.getState().speakingMessageId).toBeNull()
  })
})

describe('voiceStore — правки/удаление/вложения', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  function makeClaudeStore(): {
    store: TestStore
    api: FakeApi
    sendClaudePrompt: ReturnType<typeof vi.fn>
    cancelClaude: ReturnType<typeof vi.fn>
    editQueued: ReturnType<typeof vi.fn>
    deleteQueued: ReturnType<typeof vi.fn>
    sendQueuedNow: ReturnType<typeof vi.fn>
  } {
    const api = createFakeApi([])
    const sendClaudePrompt = vi.fn()
    const cancelClaude = vi.fn()
    const editQueued = vi.fn()
    const deleteQueued = vi.fn()
    const sendQueuedNow = vi.fn()
    const store = createTestStore({
      api,
      delays: DELAYS,
      claudeEnabled: true,
      sendClaudePrompt,
      cancelClaude,
      editQueued,
      deleteQueued,
      sendQueuedNow
    })
    return { store, api, sendClaudePrompt, cancelClaude, editQueued, deleteQueued, sendQueuedNow }
  }

  it('cancelRequest отменяет запрос и возвращает в idle', async () => {
    const { store, cancelClaude } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    expect(store.getState().voice).toBe('thinking')

    store.actions.cancelRequest()
    expect(store.getState().voice).toBe('idle')
    expect(cancelClaude).toHaveBeenCalled()
    expect(store.getState().streamingReply).toBe('')
  })

  it('deleteMessage удаляет сообщение из ленты и БД', async () => {
    const { store, api } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('первое')
    await store.actions.submitText()
    const msg = store.getState().messages[0]
    expect(msg.text).toBe('первое')

    await store.actions.deleteMessage(msg.id)
    expect(store.getState().messages.find((m) => m.id === msg.id)).toBeUndefined()
    expect(api._state.messages.find((m) => m.id === msg.id)).toBeUndefined()
  })

  it('editMessage удаляет сообщение и последующие, отправляет исправленный текст', async () => {
    const { store, api, sendClaudePrompt } = makeClaudeStore()
    await store.actions.init()
    // Готовим историю: реплика пользователя + ответ.
    store.actions.setDraft('старый вопрос')
    await store.actions.submitText()
    store.actions.applyClaudeToken('ответ')
    await store.actions.applyClaudeDone('ответ')
    await vi.advanceTimersByTimeAsync(STEP)
    const first = store.getState().messages[0]
    expect(store.getState().messages.length).toBe(2)

    sendClaudePrompt.mockClear()
    await store.actions.editMessage(first.id, 'новый вопрос')

    const texts = store.getState().messages.map((m) => m.text)
    expect(texts).toEqual(['новый вопрос']) // старые удалены, добавлен исправленный
    expect(api._state.messages.some((m) => m.text === 'ответ')).toBe(false)
    expect(sendClaudePrompt).toHaveBeenCalledWith(
      expect.any(String),
      [{ speakerId: 1, text: 'новый вопрос' }],
      [],
      true
    )
  })

  it('executePlan переключает разговор в acceptEdits и повторяет исходный запрос', async () => {
    const { store, sendClaudePrompt } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('реализуй задачу')
    await store.actions.submitText()
    store.actions.applyClaudeToken('план')
    store.actions.applyClaudeDone('план', {
      request: { provider: 'claude', model: 'sonnet', prompt: 'реализуй задачу', promptChars: 15, permissionMode: 'plan', resumed: false }
    })
    await vi.advanceTimersByTimeAsync(STEP)
    const answer = store.getState().messages.find((message) => message.role === 'ai')!

    sendClaudePrompt.mockClear()
    await store.actions.executePlan(answer.id)

    expect(store.getState().conversations.find((item) => item.id === store.getState().activeId)?.permissionMode).toBe('acceptEdits')
    expect(store.getState().messages.filter((message) => message.text === 'реализуй задачу')).toHaveLength(2)
    expect(sendClaudePrompt).toHaveBeenCalledWith(
      expect.any(String),
      [{ speakerId: 1, text: 'реализуй задачу' }],
      [],
      true
    )
  })

  it('submitText прикрепляет вложения и очищает их', async () => {
    const { store, sendClaudePrompt } = makeClaudeStore()
    await store.actions.init()
    // jsdom не реализует File.arrayBuffer(), поэтому File-подобный объект.
    const file = {
      name: 'скрин.png',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    } as unknown as File
    await store.actions.addAttachment(file)
    expect(store.getState().attachments.length).toBe(1)
    const attId = store.getState().attachments[0].id

    store.actions.setDraft('посмотри файл')
    await store.actions.submitText()

    expect(store.getState().attachments).toEqual([]) // очищены после отправки
    expect(sendClaudePrompt).toHaveBeenCalledWith(
      expect.any(String),
      [{ speakerId: 1, text: 'посмотри файл' }],
      [attId],
      true
    )
    // В историю попала пометка о вложении.
    expect(store.getState().messages[0].text).toContain('📎 скрин.png')
  })
})

describe('voiceStore — управление моделями/голосами', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('init грузит список моделей Whisper', async () => {
    const { store } = makeStore()
    await store.actions.init()
    expect(store.getState().whisperModels.length).toBeGreaterThan(0)
    expect(store.getState().whisperModels.some((m) => m.present)).toBe(true)
  })

  it('deleteModel и deleteVoice вызывают соответствующие каналы api', async () => {
    const { store, api } = makeStore()
    const spyModel = vi.spyOn(api, 'stt:deleteModel')
    const spyVoice = vi.spyOn(api, 'tts:deleteVoice')
    await store.actions.init()

    await store.actions.deleteModel('small')
    expect(spyModel).toHaveBeenCalledWith({ model: 'small' })

    await store.actions.deleteVoice('ru_RU-irina-medium')
    expect(spyVoice).toHaveBeenCalledWith({ id: 'ru_RU-irina-medium' })
  })
})

describe('voiceStore — Проводник Codex', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('openCodexObserver грузит проекты; select сохраняет cwd/id', async () => {
    const { store, api } = makeStore()
    const spyProjects = vi.spyOn(api, 'cx:projects')
    await store.actions.init()

    await store.actions.openCodexObserver()
    expect(store.getState().cxOpen).toBe(true)
    expect(spyProjects).toHaveBeenCalledOnce()

    await store.actions.selectCxProject('/U/x/a')
    expect(store.getState().cxProjectCwd).toBe('/U/x/a')

    await store.actions.selectCxSession('sid-1')
    expect(store.getState().cxSessionId).toBe('sid-1')

    store.actions.closeCodexObserver()
    expect(store.getState().cxOpen).toBe(false)
    expect(store.getState().cxSessionId).toBeNull()
  })

  it('resumeCxSession импортирует разговор и переключает движок на Codex', async () => {
    const { store, api } = makeStore()
    const spyResume = vi.spyOn(api, 'cx:resume')
    const spySave = vi.spyOn(api, 'settings:save')
    await store.actions.init()
    expect(store.getState().settings.llmProvider).toBe('claude')

    await store.actions.resumeCxSession('sid-42')

    expect(spyResume).toHaveBeenCalledWith({ id: 'sid-42' })
    expect(store.getState().activeId).not.toBeNull()
    expect(store.getState().cxOpen).toBe(false)
    // Движок переключён на Codex, чтобы следующий ход продолжил сессию.
    expect(store.getState().settings.llmProvider).toBe('codex')
    expect(spySave).toHaveBeenCalledWith(expect.objectContaining({ llmProvider: 'codex' }))
  })
})

describe('voiceStore — ходы, переживающие обновление страницы (activeTurns)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  function makeClaudeStore(): {
    store: TestStore
    api: FakeApi
    sendClaudePrompt: ReturnType<typeof vi.fn>
    cancelClaude: ReturnType<typeof vi.fn>
    editQueued: ReturnType<typeof vi.fn>
    deleteQueued: ReturnType<typeof vi.fn>
    reorderQueued: ReturnType<typeof vi.fn>
    sendQueuedNow: ReturnType<typeof vi.fn>
  } {
    const api = createFakeApi([])
    const sendClaudePrompt = vi.fn()
    const cancelClaude = vi.fn()
    const editQueued = vi.fn()
    const deleteQueued = vi.fn()
    const reorderQueued = vi.fn()
    const sendQueuedNow = vi.fn()
    const store = createTestStore({
      api,
      delays: DELAYS,
      claudeEnabled: true,
      sendClaudePrompt,
      cancelClaude,
      editQueued,
      deleteQueued,
      reorderQueued,
      sendQueuedNow
    })
    return { store, api, sendClaudePrompt, cancelClaude, editQueued, deleteQueued, reorderQueued, sendQueuedNow }
  }

  /** Сообщение «как из БД сервера» (сервер сохраняет ответ сам). */
  function aiMessage(conversationId: string, text: string): Message {
    return {
      id: `srv-${text}`,
      conversationId,
      role: 'ai',
      text,
      time: '12:00',
      createdAt: 1,
      engine: 'claude'
    }
  }

  it('добавляет сохранённое сообщение с task-launch метой без отдельного состояния предложения', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    const id = store.getState().activeId!
    const message = { ...aiMessage(id, 'Выберите вариант.'), meta: { taskLaunch: { title: 'Задача', description: 'Описание', acceptanceCriteria: 'Критерий' } } }

    await store.actions.applyClaudeDone(message.text, message.meta, 'claude', message, id)

    expect(store.getState().messages).toContainEqual(message)
    expect(store.getState().error).toBeNull()
  })

  it('applyClaudeActive восстанавливает стрим активного разговора после обновления', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    const id = store.getState().activeId!
    // «Обновление страницы»: повторный выбор разговора сбрасывает UI в idle.
    await store.actions.selectConversation(id)
    expect(store.getState().voice).toBe('idle')
    // Снапшот активных ходов с сервера → стрим продолжается с накопленного места.
    store.actions.applyClaudeActive([{ conversationId: id, partial: 'Нача' }])
    expect(store.getState().voice).toBe('thinking')
    expect(store.getState().streamingReply).toBe('Нача')
    store.actions.applyClaudeToken('ло', id)
    expect(store.getState().streamingReply).toBe('Начало')
  })

  it('applyClaudeActive восстанавливает и счётчик действий (liveActivity)', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    const id = store.getState().activeId!
    await store.actions.selectConversation(id) // «обновление страницы»
    expect(store.getState().liveActivity).toEqual([])
    const activity: ClaudeLogEntry[] = [
      { kind: 'tool_use', summary: 'Bash: ls', raw: '{}' },
      { kind: 'tool_result', summary: 'ок', raw: '{}' }
    ]
    store.actions.applyClaudeActive([{ conversationId: id, partial: 'Нача', activity }])
    expect(store.getState().liveActivity).toHaveLength(2)
    // Новые записи продолжают счёт с накопленного, а не заново.
    store.actions.applyClaudeLog({ kind: 'tool_use', summary: 'Read: x', raw: '{}' }, id)
    expect(store.getState().liveActivity).toHaveLength(3)
  })

  it('done с сохранённым сервером сообщением добавляет его в ленту без повторной записи', async () => {
    const { store, api } = makeClaudeStore()
    const spyAdd = vi.spyOn(api, 'messages:add')
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    const id = store.getState().activeId!
    spyAdd.mockClear() // submitText записал реплику пользователя — не считаем её
    store.actions.applyClaudeToken('Привет', id)
    store.actions.applyClaudeDone('Привет', undefined, 'claude', aiMessage(id, 'Привет'), id)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().messages.some((m) => m.id === 'srv-Привет')).toBe(true)
    expect(spyAdd).not.toHaveBeenCalled() // клиент не пишет ответ в БД сам
    expect(store.getState().voice).toBe('speaking')
    await vi.advanceTimersByTimeAsync(STEP)
    expect(store.getState().voice).toBe('idle')
  })

  it('замена активного сообщения очищает partial и начинает объединённый ход заново', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('первый вопрос')
    await store.actions.submitText()
    const id = store.getState().activeId!
    const active = store.getState().messages.at(-1)!
    store.actions.applyClaudeToken('Старый partial', id)

    const merged = { ...active, id: 'merged-message', text: 'первый вопрос\n\nдополнение' }
    store.actions.applyClaudeQueue(id, [], false, merged, [active.id, 'queued-message'])
    expect(store.getState().messages.find((message) => message.id === active.id)).toBeUndefined()
    expect(store.getState().messages.at(-1)).toEqual(merged)
    expect(store.getState().streamingReply).toBe('')

    store.actions.applyClaudeToken('Новый ответ', id)
    expect(store.getState().streamingReply).toBe('Новый ответ')
  })

  it('applyClaudeStart даёт liveTarget активному разговору; done его снимает; чужой ход — только в activeTargets', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    const id = store.getState().activeId!
    const target = { provider: 'codex' as const, model: 'gpt-5.6-sol', execTarget: 'm1' }
    store.actions.applyClaudeStart(target, id)
    expect(store.getState().liveTarget).toEqual(target)
    store.actions.applyClaudeStart({ provider: 'claude', model: 'opus', execTarget: null }, 'другой')
    expect(store.getState().liveTarget).toEqual(target)
    expect(store.getState().activeTargets['другой']?.model).toBe('opus')
    store.actions.applyClaudeDone('ок', undefined, 'codex', aiMessage(id, 'ок'), id)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().liveTarget).toBeNull()
    expect(store.getState().activeTargets[id]).toBeUndefined()
  })

  it('applyClaudeActive восстанавливает liveTarget из снапшота ходов', async () => {
    const { store } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    const id = store.getState().activeId!
    await store.actions.selectConversation(id)
    store.actions.applyClaudeActive([{ conversationId: id, partial: 'Нача', provider: 'codex', model: 'gpt', execTarget: 'm1' }])
    expect(store.getState().liveTarget).toEqual({ provider: 'codex', model: 'gpt', execTarget: 'm1' })
  })

  it('события чужого разговора копятся в activeTurns, но не трогают текущую ленту', async () => {
    const { store, api } = makeClaudeStore()
    const spyAdd = vi.spyOn(api, 'messages:add')
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    spyAdd.mockClear()
    const before = store.getState().messages.length
    store.actions.applyClaudeToken('фон', 'другой-разговор')
    expect(store.getState().streamingReply).toBe('')
    expect(store.getState().activeTurns['другой-разговор']).toBe('фон')
    store.actions.applyClaudeDone(
      'фон',
      undefined,
      'claude',
      aiMessage('другой-разговор', 'фон'),
      'другой-разговор'
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().messages).toHaveLength(before)
    expect(spyAdd).not.toHaveBeenCalled()
    expect(store.getState().activeTurns['другой-разговор']).toBeUndefined()
  })

  it('переключение разговора не отменяет ход; явная отмена шлёт conversationId', async () => {
    const { store, api, cancelClaude } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('вопрос')
    await store.actions.submitText()
    const first = store.getState().activeId!
    const conv = await api['conversations:create']({ title: 'Другой' })
    await store.actions.selectConversation(conv.id)
    expect(cancelClaude).not.toHaveBeenCalled() // ход первого разговора жив
    // Вернулись, ход ещё активен — стрим восстановился, отмена адресная.
    await store.actions.selectConversation(first)
    store.actions.applyClaudeActive([{ conversationId: first, partial: 'x' }])
    store.actions.cancelRequest()
    expect(cancelClaude).toHaveBeenCalledWith(first)
  })

  it('восстанавливает очередь и адресует edit/delete/send now активному разговору', async () => {
    const { store, editQueued, deleteQueued, reorderQueued, sendQueuedNow } = makeClaudeStore()
    await store.actions.init()
    store.actions.setDraft('активный')
    await store.actions.submitText()
    const conversationId = store.getState().activeId!
    const item = { id: 'q1', conversationId, messageId: 'm2', text: 'Следующий', attachments: ['f1'], position: 1, status: 'queued' as const, createdAt: 1 }
    store.actions.applyClaudeQueue(conversationId, [item], true)
    expect(store.getState().queuedTurns[conversationId]).toEqual([item])
    expect(store.getState().queuePaused[conversationId]).toBe(true)
    const published = { id: 'm2', conversationId, role: 'u1' as const, text: 'Следующий', time: '10:01', createdAt: 1 }
    store.actions.applyClaudeQueue(conversationId, [], false, published)
    expect(store.getState().queuedTurns[conversationId]).toEqual([])
    expect(store.getState().messages.filter((message) => message.id === 'm2')).toEqual([published])
    store.actions.applyClaudeQueue(conversationId, [], false, published)
    expect(store.getState().messages.filter((message) => message.id === 'm2')).toHaveLength(1)
    const second = { ...item, id: 'q2', messageId: 'm3', text: 'Ещё', position: 2 }
    store.actions.applyClaudeQueue(conversationId, [item, second], true)
    store.actions.reorderQueued(['q2', 'q1'])
    expect(store.getState().queuedTurns[conversationId]?.map((queued) => queued.id)).toEqual(['q2', 'q1'])
    expect(reorderQueued).toHaveBeenCalledWith(conversationId, ['q2', 'q1'])
    // Авторитетный ответ сервера откатывает неуспешную оптимистичную перестановку.
    store.actions.applyClaudeQueue(conversationId, [item, second], true)
    expect(store.getState().queuedTurns[conversationId]?.map((queued) => queued.id)).toEqual(['q1', 'q2'])
    store.actions.editQueued('q1', 'Исправленный')
    store.actions.deleteQueued('q1')
    store.actions.sendQueuedNow('q1')
    expect(editQueued).toHaveBeenCalledWith(conversationId, 'q1', 'Исправленный')
    expect(deleteQueued).toHaveBeenCalledWith(conversationId, 'q1')
    expect(sendQueuedNow).toHaveBeenCalledWith(conversationId, 'q1')
  })
})

describe('voiceStore — сессия/аутентификация (web)', () => {
  it('без моста сессии (desktop) — authRequired=false, роль admin, init грузит данные', async () => {
    const { store } = makeStore(['Разговор'])
    await store.actions.init()
    expect(store.getState().authRequired).toBe(false)
    expect(store.getState().currentUser).toEqual({ name: '', role: 'admin' })
    expect(store.getState().conversations.length).toBe(1)
  })

  it('с мостом сессии: нет сохранённой сессии → показываем логин (данные не грузим)', async () => {
    const api = createFakeApi(['Разговор'])
    const session = {
      me: vi.fn().mockResolvedValue(null),
      login: vi.fn(),
      logout: vi.fn()
    }
    const store = createTestStore({ api, session })
    await store.actions.init()
    expect(store.getState().authRequired).toBe(true)
    expect(store.getState().currentUser).toBeNull()
    expect(store.getState().conversations).toEqual([]) // bootstrap не запускался
  })

  it('login: успех выставляет пользователя и грузит данные; провал — ошибка', async () => {
    const api = createFakeApi(['Разговор'])
    const session = {
      me: vi.fn().mockResolvedValue(null),
      login: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ name: 'user', role: 'user' }),
      logout: vi.fn()
    }
    const store = createTestStore({ api, session })
    await store.actions.init()

    // Первая попытка — неверные данные.
    await store.actions.login('user', 'x')
    expect(store.getState().currentUser).toBeNull()
    expect(store.getState().authError).toBeTruthy()

    // Вторая — успех: пользователь + загрузка разговоров.
    await store.actions.login('user', '')
    expect(store.getState().currentUser).toEqual({ name: 'user', role: 'user' })
    expect(store.getState().authError).toBeNull()
    expect(store.getState().conversations.length).toBe(1)
  })

  it('ошибка logout сохраняет авторизацию и пользовательские данные', async () => {
    const api = createFakeApi(['Разговор'])
    const session = {
      me: vi.fn().mockResolvedValue({ name: 'admin', role: 'admin' }),
      login: vi.fn(),
      logout: vi.fn().mockRejectedValue(new Error('Не удалось завершить сессию. Попробуйте ещё раз.'))
    }
    const store = createTestStore({ api, session })
    await store.actions.init()

    await expect(store.actions.logout()).rejects.toThrow('Не удалось завершить сессию. Попробуйте ещё раз.')

    expect(store.getState().currentUser).toEqual({ name: 'admin', role: 'admin' })
    expect(store.getState().conversations).toHaveLength(1)
  })

  it('logout очищает пользователя и возвращает на экран логина', async () => {
    const api = createFakeApi(['Разговор'])
    const session = {
      me: vi.fn().mockResolvedValue({ name: 'admin', role: 'admin' }),
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined)
    }
    const store = createTestStore({ api, session })
    await store.actions.init()
    expect(store.getState().currentUser).toEqual({ name: 'admin', role: 'admin' })

    await store.actions.logout()
    expect(session.logout).toHaveBeenCalled()
    expect(store.getState().currentUser).toBeNull()
    expect(store.getState().authRequired).toBe(true)
    expect(store.getState().conversations).toEqual([])
  })
})

describe('voiceStore — машинные утилиты', () => {
  function makeFs() {
    const listing = { root: '/r', cwd: '/r', entries: [{ name: 'a.txt', kind: 'file' as const, size: 1, mtime: 0 }] }
    return {
      list: vi.fn().mockResolvedValue(listing),
      read: vi.fn().mockResolvedValue({ root: '/r', cwd: '/r', dataBase64: btoa('hi'), name: 'a.txt' }),
      write: vi.fn().mockResolvedValue(listing),
      remove: vi.fn().mockResolvedValue(listing),
      rename: vi.fn().mockResolvedValue(listing),
      mkdir: vi.fn().mockResolvedValue(listing),
      exec: vi.fn().mockResolvedValue({ exitCode: 0, output: 'ok', timedOut: false })
    }
  }

  it('тонкие ops пробрасывают вызовы в мост fs', async () => {
    const fs = makeFs()
    const store = createTestStore({ api: createFakeApi([]), fs })
    const res = await store.actions.fsList('m1', '/x')
    expect(fs.list).toHaveBeenCalledWith('m1', '/x')
    expect(res.entries).toHaveLength(1)
    const exec = await store.actions.agentExec('m1', 'ls')
    expect(fs.exec).toHaveBeenCalledWith('m1', 'ls', undefined)
    expect(exec.output).toBe('ok')
    // «Стоп» в консоли — тот же вызов, но с сигналом отмены.
    const ctrl = new AbortController()
    await store.actions.agentExec('m1', 'sleep 1', ctrl.signal)
    expect(fs.exec).toHaveBeenLastCalledWith('m1', 'sleep 1', ctrl.signal)
  })

  it('история команд консоли: по машине, без подряд идущих дублей, с капом', () => {
    const store = createTestStore({ api: createFakeApi([]), fs: makeFs() })
    store.actions.pushConsoleCommand('m1', 'ls')
    store.actions.pushConsoleCommand('m1', 'ls') // подряд повторённую не дублируем
    store.actions.pushConsoleCommand('m1', ' pwd ') // хранится обрезанной
    store.actions.pushConsoleCommand('m2', 'git status')
    store.actions.pushConsoleCommand('m1', '') // пустую не помним
    expect(store.getState().consoleHistory.m1).toEqual(['ls', 'pwd'])
    expect(store.getState().consoleHistory.m2).toEqual(['git status'])

    for (let i = 0; i < 120; i += 1) store.actions.pushConsoleCommand('m3', `cmd${i}`)
    const m3 = store.getState().consoleHistory.m3 ?? []
    expect(m3).toHaveLength(100)
    expect(m3[0]).toBe('cmd20')
    expect(m3.at(-1)).toBe('cmd119')
  })

  it('openUtility предпочитает машину активного разговора', async () => {
    const { store } = makeStore(['A'])
    await store.actions.init()
    store.actions.applyAgents([
      { id: 'other', name: 'Other', online: true, createdAt: 1, lastSeen: null, policy: DEFAULT_AGENT_POLICY },
      { id: 'chat', name: 'Chat', online: true, createdAt: 1, lastSeen: null, policy: DEFAULT_AGENT_POLICY }
    ])
    await store.actions.setConversationExecTarget(store.getState().activeId!, 'chat')
    store.actions.openUtility('explorer')
    expect(store.getState().utility?.agentId).toBe('chat')
  })

  it('openUtility выбирает онлайн-машину и открывает; closeUtility закрывает', () => {
    const store = createTestStore({ api: createFakeApi([]), fs: makeFs() })
    store.actions.openUtility('console', 'm1', '/work')
    expect(store.getState().utility).toEqual({ kind: 'console', agentId: 'm1', path: '/work' })
    store.actions.closeUtility()
    expect(store.getState().utility).toBeNull()
  })

  it('openUtility с dir открывает проводник ВНУТРИ папки (переключение из терминала)', () => {
    const store = createTestStore({ api: createFakeApi([]), fs: makeFs() })
    store.actions.openUtility('explorer', 'm1', '/work', true)
    // Без dir тот же путь считался бы файлом, и проводник открыл бы его родителя.
    expect(store.getState().utility).toEqual({ kind: 'explorer', agentId: 'm1', path: '/work', dir: true })
  })

  it('newConversation("make") создаёт проект «Проект N» и кладёт его в makeConversations', async () => {
    const store = createTestStore({ api: createFakeApi([]), fs: makeFs() })
    await store.actions.init()
    const first = await store.actions.newConversation('make')
    const second = await store.actions.newConversation('make')
    const titles = store.getState().makeConversations.map((c) => c.title).sort()
    expect(titles).toEqual(['Проект 1', 'Проект 2'])
    expect(store.getState().makeConversations.every((c) => c.assistantKind === 'make')).toBe(true)
    expect(store.getState().readerConversations.map((c) => c.id)).not.toContain(first)
    expect(store.getState().consoleReaderConversations.map((c) => c.id)).not.toContain(second)
  })

  it('в «Консоли с ассистентом» «открой консоль» не открывает второй виджет, а уходит модели', async () => {
    const store = createTestStore({ api: createFakeApi([]), fs: makeFs() })
    await store.actions.init()
    await store.actions.newConversation('console-reader')
    store.actions.setDraft('открой консоль')
    await store.actions.submitText()
    const msgs = store.getState().messages
    expect(msgs.some((m) => m.text.includes('```tool'))).toBe(false)
    // Реплика ушла как обычный ход — стор не остался в idle.
    expect(store.getState().voice).not.toBe('idle')
  })

  it('команда «открой консоль» создаёт ai-сообщение с tool-блоком (без LLM)', async () => {
    const store = createTestStore({ api: createFakeApi([]), fs: makeFs() })
    await store.actions.init()
    store.actions.setDraft('открой консоль')
    await store.actions.submitText()
    const msgs = store.getState().messages
    const last = msgs[msgs.length - 1]
    expect(last.role).toBe('ai')
    expect(last.text).toContain('```tool')
    expect(last.text).toContain('"kind":"console"')
    // Остаёмся в idle (в LLM не ходили).
    expect(store.getState().voice).toBe('idle')
  })
})

describe('voiceStore — админ-страница пользователей', () => {
  it('openUsers грузит список; createUserAccount обновляет его', async () => {
    const store = createTestStore({ api: createFakeApi([]) })
    await store.actions.openUsers()
    expect(store.getState().usersOpen).toBe(true)
    expect(store.getState().adminUsers.map((u) => u.name)).toContain('admin')
    await store.actions.createUserAccount('bob', 'pw', 'developer')
    expect(store.getState().adminUsers.map((u) => u.name)).toContain('bob')
  })
})

describe('voiceStore — помощник промптов', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('suggestPrompts: открывает панель с вариантами от api', async () => {
    const { store, api } = makeStore()
    const spy = vi.spyOn(api, 'prompt:suggest')
    await store.actions.init()
    store.actions.setDraft('сделай форму')

    await store.actions.suggestPrompts()

    expect(spy).toHaveBeenCalledWith({ prompt: 'сделай форму', modifiers: expect.arrayContaining([expect.objectContaining({ id: 'clear' })]) })
    const helper = store.getState().promptHelper
    expect(helper.open).toBe(true)
    expect(helper.loading).toBe(false)
    expect(helper.variants).toEqual(['сделай форму — уточнённый вариант'])
    expect(helper.error).toBeNull()
  })

  it('suggestPrompts: пустой черновик — панель не открывается, api не дёргается', async () => {
    const { store, api } = makeStore()
    const spy = vi.spyOn(api, 'prompt:suggest')
    await store.actions.init()
    store.actions.setDraft('   ')

    await store.actions.suggestPrompts()

    expect(spy).not.toHaveBeenCalled()
    expect(store.getState().promptHelper.open).toBe(false)
  })

  it('applyPromptSuggestion: заполняет черновик и закрывает панель', async () => {
    const { store } = makeStore()
    await store.actions.init()
    store.actions.setDraft('черновик')
    await store.actions.suggestPrompts()

    store.actions.applyPromptSuggestion('готовая формулировка')

    expect(store.getState().draft).toBe('готовая формулировка')
    expect(store.getState().promptHelper.open).toBe(false)
    expect(store.getState().promptHelper.variants).toEqual([])
  })

  it('closePromptSuggestions: закрывает панель, черновик не трогает', async () => {
    const { store } = makeStore()
    await store.actions.init()
    store.actions.setDraft('черновик')
    await store.actions.suggestPrompts()

    store.actions.closePromptSuggestions()

    expect(store.getState().promptHelper.open).toBe(false)
    expect(store.getState().draft).toBe('черновик')
  })

  it('suggestPrompts: ошибка api → панель показывает текст ошибки', async () => {
    const { store, api } = makeStore()
    vi.spyOn(api, 'prompt:suggest').mockRejectedValueOnce(new Error('Движок недоступен'))
    await store.actions.init()
    store.actions.setDraft('текст')

    await store.actions.suggestPrompts()

    const helper = store.getState().promptHelper
    expect(helper.open).toBe(true)
    expect(helper.loading).toBe(false)
    expect(helper.error).toBe('Движок недоступен')
    expect(helper.variants).toEqual([])
  })
})

describe('voiceStore — чаты завершённых задач', () => {
  /** Проект с задачей в «Готово» и её чатом; сайдбар сужен этим проектом. */
  async function withDoneTaskChat(): Promise<{ store: TestStore; api: FakeApi; chatId: string; taskId: string; projectId: string }> {
    const { store, api } = makeStore(['Обычный'])
    const p = await api['projects:create']({ name: 'P' })
    const board = await api['board:get']({ id: p.id })
    const done = board.columns.find((c) => c.semanticType === 'done')!
    const task = await api['tasks:create']({ projectId: p.id, columnId: board.columns[0]!.id, title: 'Скролл' })
    const chat = await api['tasks:openChat']({ projectId: p.id, taskId: task.id })
    await api['tasks:move']({ projectId: p.id, taskId: task.id, columnId: done.id })
    await store.actions.init()
    await store.actions.setSidebarProjects([p.id])
    return { store, api, chatId: chat.id, taskId: task.id, projectId: p.id }
  }

  it('список без чата завершённой задачи; переключатель возвращает его и запоминается', async () => {
    const { store, chatId } = await withDoneTaskChat()
    expect(store.getState().conversations.map((c) => c.id)).not.toContain(chatId)

    await store.actions.setShowDoneTaskChats(true)
    expect(store.getState().conversations.map((c) => c.id)).toContain(chatId)
    expect(localStorage.getItem('vc.sidebar.doneTaskChats')).toBe('1')

    await store.actions.setShowDoneTaskChats(false)
    expect(store.getState().conversations.map((c) => c.id)).not.toContain(chatId)
    expect(localStorage.getItem('vc.sidebar.doneTaskChats')).toBeNull()
  })

  it('открытый скрытый чат остаётся в списке — иначе пропали бы его машина и папка', async () => {
    const { store, chatId } = await withDoneTaskChat()
    expect(await store.actions.selectConversation(chatId)).toBe(true)
    expect(store.getState().conversations.map((c) => c.id)).toContain(chatId)
    // Перечитывание списка активную строку не роняет.
    await store.actions.retryConversations()
    expect(store.getState().conversations.map((c) => c.id)).toContain(chatId)
  })

  it('cancelled скрыт даже при включённых done-чатах и возвращается без потери черновика', async () => {
    const { store, api } = makeStore(['Обычный'])
    const p = await api['projects:create']({ name: 'P' })
    const board = await api['board:get']({ id: p.id })
    const dev = board.columns.find((c) => c.semanticType === 'development')!
    const cancelled = board.columns.find((c) => c.semanticType === 'cancelled')!
    const task = await api['tasks:create']({ projectId: p.id, columnId: dev.id, title: 'Отмена' })
    const chat = await api['tasks:openChat']({ projectId: p.id, taskId: task.id })
    await store.actions.init()
    await store.actions.setSidebarProjects([p.id])
    expect(await store.actions.selectConversation(chat.id)).toBe(true)
    store.actions.setDraft('не потерять')
    await store.actions.setShowDoneTaskChats(true)

    await api['tasks:move']({ projectId: p.id, taskId: task.id, columnId: cancelled.id })
    await store.actions.retryConversations()
    expect(store.getState().activeId).toBe(chat.id)
    expect(store.getState().draft).toBe('не потерять')
    expect(store.getState().conversations.map((c) => c.id)).not.toContain(chat.id)

    await api['tasks:move']({ projectId: p.id, taskId: task.id, columnId: dev.id })
    await store.actions.retryConversations()
    expect(store.getState().conversations.map((c) => c.id)).toContain(chat.id)
  })

  it('возврат задачи из «Готово» возвращает чат в список', async () => {
    const { store, api, chatId, taskId, projectId } = await withDoneTaskChat()
    const board = await api['board:get']({ id: projectId, includeCompleted: true })
    const dev = board.columns.find((c) => c.semanticType !== 'done')!
    await api['tasks:move']({ projectId, taskId, columnId: dev.id })

    await store.actions.retryConversations()
    expect(store.getState().conversations.map((c) => c.id)).toContain(chatId)
  })
})
