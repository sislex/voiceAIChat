import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createVoiceStore, type VoiceStore } from './voiceStore'
import { createFakeApi, type FakeApi } from '../test/fakeApi'
import type { ClaudeLogEntry } from '@shared/types'

// Быстрые задержки + фейковые таймеры делают мок-пайплайн детерминированным.
const DELAYS = { frame: 20, transcribe: 20, think: 20, speak: 20 }
// STEP строго между одинарной и двойной задержкой: за один сдвиг срабатывает
// ровно одно звено цепочки таймеров (иначе этапы «схлопываются»).
const STEP = 25

function makeStore(seed: string[] = []): { store: VoiceStore; api: FakeApi } {
  const api = createFakeApi(seed)
  const store = createVoiceStore({ api, now: () => 1_700_000_000_000, delays: DELAYS })
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

  it('submitText: создаёт разговор, персистит реплику и проходит thinking → speaking → idle', async () => {
    const { store, api } = makeStore()
    const spyAdd = vi.spyOn(api, 'messages:add')
    await store.actions.init()

    store.actions.setDraft('Привет, Claude')
    await store.actions.submitText()

    // Разговор создан, реплика пользователя записана, черновик очищен, состояние — thinking.
    expect(store.getState().activeId).not.toBeNull()
    expect(spyAdd).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'u1', text: 'Привет, Claude' })
    )
    expect(store.getState().draft).toBe('')
    expect(store.getState().voice).toBe('thinking')

    await vi.advanceTimersByTimeAsync(STEP) // think → speaking + персист ответа ai
    expect(store.getState().voice).toBe('speaking')
    expect(store.getState().messages.some((m) => m.role === 'ai')).toBe(true)

    await vi.advanceTimersByTimeAsync(STEP) // speak → idle
    expect(store.getState().voice).toBe('idle')
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

    store.actions.newConversation()

    expect(store.getState().activeId).toBeNull()
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

  it('init грузит список MCP-серверов', async () => {
    const api = createFakeApi([])
    vi.spyOn(api, 'mcp:list').mockResolvedValue([
      { name: 'fs', detail: 'npx server', status: '✓ Connected', connected: true }
    ])
    const store = createVoiceStore({ api, now: () => 1, delays: DELAYS })
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
    const store = createVoiceStore({ api, now: () => 1_700_000_000_000, delays: DELAYS, download })
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
    const store = createVoiceStore({ api, delays: DELAYS, listMics })

    await store.actions.init()

    expect(listMics).toHaveBeenCalled()
    expect(store.getState().mics).toEqual([{ deviceId: 'mic-a', label: 'Микрофон A' }])
  })

  it('startVoice запускает захват с выбранным устройством, stopVoice — останавливает', async () => {
    const api = createFakeApi([])
    const audio = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }
    const store = createVoiceStore({ api, delays: DELAYS, audio })
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

  function makeSttStore(): VoiceStore {
    const api = createFakeApi([])
    return createVoiceStore({ api, delays: DELAYS, sttEnabled: true })
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
    store: VoiceStore
    sendClaudePrompt: ReturnType<typeof vi.fn>
    cancelClaude: ReturnType<typeof vi.fn>
  } {
    const api = createFakeApi([])
    const sendClaudePrompt = vi.fn()
    const cancelClaude = vi.fn()
    const store = createVoiceStore({
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
      false // showConsole по умолчанию выключен → verbose=false
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
    store.actions.applyClaudeError('Claude CLI не найден')
    expect(store.getState().voice).toBe('idle')
    expect(store.getState().error).toBe('Claude CLI не найден')

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

  async function speakingStore(bargeIn: boolean): Promise<VoiceStore> {
    const api = createFakeApi([])
    const store = createVoiceStore({
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
    const store = createVoiceStore({ api, delays: DELAYS })
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
    const store = createVoiceStore({ api, delays: DELAYS })
    await store.actions.init()
    store.actions.startVoice()
    for (let i = 0; i < 3; i++) store.actions.applyMicEnergy(0.5)
    for (let i = 0; i < 10; i++) store.actions.applyMicEnergy(0)
    expect(store.getState().voice).toBe('listening')
  })

  it('после ответа (speaking → idle) hands-free авто-стартует запись', async () => {
    const api = createFakeApi([])
    const store = createVoiceStore({
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
    vi.spyOn(api, 'cc:transcript').mockResolvedValue([{ kind: 'user', text: 'Привет' }])
    const ccTailStart = vi.fn()
    const ccTailStop = vi.fn()
    const store = createVoiceStore({ api, now: () => 1, ccTailStart, ccTailStop })

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
    const store = createVoiceStore({ api, delays: DELAYS })
    store.actions.applyClaudeLog(entry('Bash: ls'))
    store.actions.applyClaudeLog(entry('Read: index.ts'))
    expect(store.getState().consoleLog.map((e) => e.summary)).toEqual(['Bash: ls', 'Read: index.ts'])
  })

  it('toggleConsole переключает признак развёрнутости панели', () => {
    const api = createFakeApi([])
    const store = createVoiceStore({ api, delays: DELAYS })
    const initial = store.getState().consoleOpen
    store.actions.toggleConsole()
    expect(store.getState().consoleOpen).toBe(!initial)
    store.actions.toggleConsole()
    expect(store.getState().consoleOpen).toBe(initial)
  })

  it('submitText передаёт verbose=true в Claude, когда showConsole включён', async () => {
    const api = createFakeApi([])
    const sendClaudePrompt = vi.fn()
    const store = createVoiceStore({
      api,
      delays: DELAYS,
      claudeEnabled: true,
      sendClaudePrompt
    })
    await store.actions.init()
    await store.actions.updateSettings({ showConsole: true })
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
    store.actions.newConversation()
    expect(store.getState().consoleLog).toEqual([])
  })
})

describe('voiceStore — статус и скачивание модели (Шаг 9)', () => {
  it('init выставляет modelPresent из getSttStatus', async () => {
    const api = createFakeApi([])
    const getSttStatus = vi.fn().mockResolvedValue({ present: false, model: 'large-v3-turbo' })
    const store = createVoiceStore({ api, getSttStatus })
    await store.actions.init()
    expect(getSttStatus).toHaveBeenCalled()
    expect(store.getState().modelPresent).toBe(false)
  })

  it('downloadModel запускает загрузку; прогресс и done обновляют состояние', async () => {
    const api = createFakeApi([])
    const startModelDownload = vi.fn()
    const store = createVoiceStore({
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
    const store = createVoiceStore({
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
    const store = createVoiceStore({ api })
    await store.actions.init()
    expect(store.getState().voicesDownloadable).toBe(true)
    expect(store.getState().voiceCatalog.length).toBeGreaterThan(0)
  })

  it('downloadVoice запускает загрузку; прогресс/done обновляют состояние', async () => {
    const api = createFakeApi([])
    const startVoiceDownload = vi.fn()
    const store = createVoiceStore({ api, startVoiceDownload })
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
    const store = createVoiceStore({ api, startVoiceDownload: vi.fn() })
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
    store: VoiceStore
    speakText: ReturnType<typeof vi.fn>
    cancelTts: ReturnType<typeof vi.fn>
  } {
    const api = createFakeApi([])
    api._state.settings.autoSpeak = true // автоозвучка для проверки TTS-пайплайна
    const speakText = vi.fn()
    const cancelTts = vi.fn()
    const store = createVoiceStore({ api, delays: DELAYS, ttsEnabled: true, speakText, cancelTts })
    return { store, speakText, cancelTts }
  }

  async function reachSpeaking(store: VoiceStore): Promise<void> {
    await store.actions.init()
    store.actions.setDraft('привет')
    await store.actions.submitText()
    await vi.advanceTimersByTimeAsync(STEP) // think → speaking (мок-ответ)
  }

  it('speaking ведётся через TTS (без мок-таймера); applyTtsDone завершает', async () => {
    const { store, speakText } = makeTtsStore()
    await reachSpeaking(store)

    expect(store.getState().voice).toBe('speaking')
    expect(speakText).toHaveBeenCalledWith(expect.any(String), store.getState().settings.voice)

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
    store: VoiceStore
    speakText: ReturnType<typeof vi.fn>
    cancelTts: ReturnType<typeof vi.fn>
  } {
    const api = createFakeApi([])
    api._state.settings.autoSpeak = true // автоозвучка для проверки стриминга TTS
    const speakText = vi.fn()
    const cancelTts = vi.fn()
    const store = createVoiceStore({
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
    store: VoiceStore
    api: FakeApi
    sendClaudePrompt: ReturnType<typeof vi.fn>
    cancelClaude: ReturnType<typeof vi.fn>
  } {
    const api = createFakeApi([])
    const sendClaudePrompt = vi.fn()
    const cancelClaude = vi.fn()
    const store = createVoiceStore({
      api,
      delays: DELAYS,
      claudeEnabled: true,
      sendClaudePrompt,
      cancelClaude
    })
    return { store, api, sendClaudePrompt, cancelClaude }
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
      false
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
      false
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
