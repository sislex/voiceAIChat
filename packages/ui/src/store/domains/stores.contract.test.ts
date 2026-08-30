// Контракт доменных хранилищ (CHAT-236): начальное состояние, успех, ошибка,
// повтор, устаревший ответ, dispose и отсутствие уведомлений после него.

import { describe, expect, it, vi } from 'vitest'
import { createStoreCore } from '../createStore'
import { createShellStore } from './shellStore'
import { createSessionStore } from './sessionStore'
import { createSettingsStore } from './settingsStore'
import { createOperationsStore } from './operationsStore'
import { createVoiceStore } from './voiceStore'
import { createFakeApi } from '../../test/fakeApi'
import { withApi } from '../../clients/types'
import type { OperationsClient, SettingsClient } from '../../clients/types'
import type { SessionUser } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

function memoryPrefs(): { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void } {
  const map = new Map<string, string>()
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k)
  }
}

describe('createStoreCore — общая основа', () => {
  it('уведомляет подписчиков и перестаёт после dispose', () => {
    const core = createStoreCore({ n: 0 })
    const listener = vi.fn()
    core.subscribe(listener)
    core.setState({ n: 1 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(core.getState().n).toBe(1)

    core.dispose()
    core.setState({ n: 2 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(core.getState().n).toBe(1) // после dispose состояние заморожено
    expect(core.disposed()).toBe(true)
  })

  it('снимает таймеры и освобождает ресурсы при dispose', () => {
    vi.useFakeTimers()
    const core = createStoreCore({ n: 0 })
    const tick = vi.fn()
    const cleanup = vi.fn()
    core.timer(tick, 10)
    core.interval(tick, 10)
    core.onDispose(cleanup)
    core.dispose()
    vi.advanceTimersByTime(100)
    expect(tick).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('shellStore', () => {
  it('начальное состояние, очередь тостов и сброс при выходе', () => {
    const prefs = memoryPrefs()
    const store = createShellStore({ prefs })
    expect(store.getState()).toMatchObject({ settingsOpen: false, notices: [], error: null })

    store.actions.notify({ kind: 'success', text: 'ок' })
    store.actions.fail(new Error('нет сети'))
    expect(store.getState().notices.map((n) => n.kind)).toEqual(['success', 'error'])

    store.actions.dismissNotice(store.getState().notices[0].id)
    expect(store.getState().notices).toHaveLength(1)

    store.actions.setSidebarCollapsed(true)
    store.actions.openSettings()
    store.actions.reset()
    // Свёрнутость сайдбара — настройка взгляда: она переживает выход.
    expect(store.getState()).toMatchObject({ settingsOpen: false, notices: [], sidebarCollapsed: true })
    expect(prefs.get('vc:sidebarCollapsed')).toBe('1')
    store.dispose()
  })
})

describe('sessionStore', () => {
  const user: SessionUser = { name: 'ann', role: 'admin' }

  it('без клиента сессии вход не требуется', async () => {
    const store = createSessionStore()
    const events: string[] = []
    store.actions.onEvent((e) => events.push(e.type))
    await store.actions.check()
    expect(store.getState().authRequired).toBe(false)
    expect(store.getState().currentUser).not.toBeNull()
    expect(events).toEqual(['session.authenticated'])
  })

  it('в web checking=true до ответа /me, после logout/expire форма показывается сразу', async () => {
    let resolveMe: (u: SessionUser | null) => void = () => {}
    const session = {
      me: vi.fn(() => new Promise<SessionUser | null>((r) => { resolveMe = r })),
      login: vi.fn(async () => user),
      logout: vi.fn(async () => {})
    }
    const store = createSessionStore({ session: session as never })
    // До вызова check() и во время него — проверка идёт, форму логина показывать рано.
    expect(store.getState()).toMatchObject({ authRequired: true, checking: true, currentUser: null })
    const pending = store.actions.check()
    expect(store.getState().checking).toBe(true)
    resolveMe(user)
    await pending
    expect(store.getState()).toMatchObject({ checking: false, currentUser: user })

    await store.actions.logout()
    expect(store.getState()).toMatchObject({ checking: false, currentUser: null, authRequired: true })

    await store.actions.login('ann', 'x')
    store.actions.expire()
    expect(store.getState()).toMatchObject({ checking: false, currentUser: null })
  })

  it('успех, ошибка входа и выход публикуют события домена', async () => {
    const session = {
      me: vi.fn(async () => null),
      login: vi.fn(async () => user),
      logout: vi.fn(async () => {})
    }
    const store = createSessionStore({ session: session as never })
    const events: string[] = []
    store.actions.onEvent((e) => events.push(e.type))

    await store.actions.check()
    expect(store.getState()).toMatchObject({ authRequired: true, currentUser: null })

    session.login.mockResolvedValueOnce(null as never)
    await store.actions.login('ann', 'нет')
    expect(store.getState().authError).toMatch(/Неверный/)

    await store.actions.login('ann', 'да')
    expect(store.getState().currentUser).toEqual(user)

    await store.actions.logout()
    expect(store.getState().currentUser).toBeNull()
    expect(events).toEqual(['session.authenticated', 'session.signedOut'])
  })

  it('вход другим пользователем в той же вкладке даёт userChanged', async () => {
    const session = {
      me: vi.fn(async () => user),
      login: vi.fn(async () => ({ name: 'bob', role: 'developer' })),
      logout: vi.fn(async () => {})
    }
    const store = createSessionStore({ session: session as never })
    const events: string[] = []
    store.actions.onEvent((e) => events.push(e.type))
    await store.actions.check()
    await store.actions.login('bob', 'x')
    expect(events).toEqual(['session.authenticated', 'session.authenticated', 'session.userChanged'])
  })
})

describe('settingsStore', () => {
  function make(over: Partial<SettingsClient> = {}) {
    const api = createFakeApi()
    const client = withApi<SettingsClient>(api, over)
    const store = createSettingsStore({
      settings: client,
      stt: { enabled: true, inputEnabled: true },
      tts: { enabled: true }
    })
    return { store, api }
  }

  it('загружает настройки, движки и права; селекторы нормализуют доступ', async () => {
    const { store } = make()
    expect(store.getState().settings).toEqual(DEFAULT_SETTINGS)
    await store.actions.load()
    expect(store.getState().llmAccess).toEqual([])
    // Пустой deny-list — полный доступ.
    expect(store.actions.selectAllowedProviders()).toEqual(['claude', 'codex'])
    expect(store.actions.selectEffectiveVoiceSettings().voice).toBe(store.getState().settings.voice)
    store.dispose()
  })

  it('ошибка загрузки не глотается, повтор возвращает данные', async () => {
    const { store, api } = make()
    const spy = vi.spyOn(api, 'settings:get').mockRejectedValueOnce(new Error('нет сети'))
    await expect(store.actions.load()).rejects.toThrow('нет сети')
    spy.mockRestore()
    await store.actions.load()
    expect(store.getState().llmEngines).toBeDefined()
    store.dispose()
  })

  it('после dispose ответ не будит подписчиков', async () => {
    const { store } = make()
    const listener = vi.fn()
    store.subscribe(listener)
    const pending = store.actions.load()
    store.dispose()
    await pending.catch(() => {})
    expect(listener).not.toHaveBeenCalled()
  })

  // Деплой: сервер на секунды недоступен, `settings:get` падает — и раньше
  // первое же изменение уносило на сервер дефолты стора, стирая тему, движок,
  // модель и машину по умолчанию.
  it('изменение при неудачной загрузке не затирает серверные настройки', async () => {
    const { store, api } = make()
    await api['settings:save']({ ...api._state.settings, theme: 'dark', llmProvider: 'codex', defaultAgentId: 'a1' })
    vi.spyOn(api, 'settings:get').mockRejectedValueOnce(new Error('502'))
    await expect(store.actions.load()).rejects.toThrow('502')
    expect(store.getState().settingsLoaded).toBe(false)

    await store.actions.updateSettings({ autoSpeak: true })

    expect(api._state.settings).toMatchObject({ theme: 'dark', llmProvider: 'codex', defaultAgentId: 'a1', autoSpeak: true })
    expect(store.getState().settings).toMatchObject({ theme: 'dark', autoSpeak: true })
    store.dispose()
  })

  it('недоступный сервер не даёт сохранить настройки поверх незагруженных', async () => {
    const { store, api } = make()
    await api['settings:save']({ ...api._state.settings, theme: 'green' })
    vi.spyOn(api, 'settings:get').mockRejectedValue(new Error('502'))
    const save = vi.spyOn(api, 'settings:save')

    await expect(store.actions.updateSettings({ theme: 'dark' })).rejects.toThrow('502')

    expect(save).not.toHaveBeenCalled()
    expect(api._state.settings.theme).toBe('green')
    store.dispose()
  })

  it('отказ каталога движков не оставляет настройки дефолтными', async () => {
    const { store, api } = make()
    await api['settings:save']({ ...api._state.settings, theme: 'dark' })
    vi.spyOn(api, 'llm:engines').mockRejectedValueOnce(new Error('503'))

    await store.actions.load()

    expect(store.getState()).toMatchObject({ settingsLoaded: true })
    expect(store.getState().settings.theme).toBe('dark')
    store.dispose()
  })

  // Голоса Piper поднимаются позже сервера: пропавший из списка голос не должен
  // переписывать выбор пользователя в БД — иначе он теряется навсегда.
  it('исчезнувший голос подменяется только для синтеза, но не сохраняется', async () => {
    const { store, api } = make()
    await api['settings:save']({ ...api._state.settings, voice: 'ru_RU-dmitri-medium' })
    await store.actions.load()
    vi.spyOn(api, 'tts:voices').mockResolvedValueOnce([{ id: 'ru_RU-ruslan-medium', label: 'Руслан' }])
    const save = vi.spyOn(api, 'settings:save')

    await store.actions.loadCatalogs()

    expect(save).not.toHaveBeenCalled()
    expect(store.getState().settings.voice).toBe('ru_RU-dmitri-medium')
    expect(store.actions.selectEffectiveVoiceSettings().voice).toBe('ru_RU-ruslan-medium')
    store.dispose()
  })

  // Две вкладки одного пользователя: сохранение полного снимка возвращало бы
  // соседней вкладке её устаревшие значения.
  it('на сервер уходит только изменённое поле', async () => {
    const { store, api } = make()
    await store.actions.load()
    const save = vi.spyOn(api, 'settings:save')
    await api['settings:save']({ theme: 'dark' }) // соседняя вкладка сменила тему

    await store.actions.updateSettings({ autoSpeak: true })

    expect(save).toHaveBeenLastCalledWith({ autoSpeak: true })
    expect(api._state.settings).toMatchObject({ theme: 'dark', autoSpeak: true })
    store.dispose()
  })

  it('удалённая машина исчезает из настроек', async () => {
    const { store } = make()
    await store.actions.updateSettings({ execTarget: 'a1', defaultAgentId: 'a1' })
    store.actions.forgetAgent('a1')
    expect(store.getState().settings.execTarget).toBeNull()
    expect(store.getState().settings.defaultAgentId).toBeNull()
    store.dispose()
  })
})

describe('operationsStore', () => {
  function make() {
    const api = createFakeApi()
    const fails: unknown[] = []
    const store = createOperationsStore({
      operations: withApi<OperationsClient>(api, {}),
      download: { file: vi.fn(), bytes: vi.fn(), open: vi.fn() },
      activeChat: () => ({ execTarget: null, workdir: null, projectId: undefined }),
      fail: (err) => fails.push(err)
    })
    return { store, api, fails }
  }

  it('ошибка списка машин видна на экране, а не только в консоли', async () => {
    const { store, api } = make()
    expect(store.getState().agentsStatus).toBe('loading')
    vi.spyOn(api, 'agents:list').mockRejectedValueOnce(new Error('нет сети'))
    await store.actions.refreshAgents()
    expect(store.getState()).toMatchObject({ agentsStatus: 'error', agentsError: 'нет сети' })

    await store.actions.refreshAgents()
    expect(store.getState().agentsStatus).toBe('ready')
    store.dispose()
  })

  it('история команд консоли не копит подряд одинаковые', () => {
    const { store } = make()
    store.actions.pushConsoleCommand('a1', 'ls')
    store.actions.pushConsoleCommand('a1', 'ls')
    store.actions.pushConsoleCommand('a1', 'pwd')
    expect(store.getState().consoleHistory.a1).toEqual(['ls', 'pwd'])
    store.dispose()
  })

  it('dispose закрывает live-tail наблюдателей', () => {
    const ccTailStop = vi.fn()
    const cxTailStop = vi.fn()
    const store = createOperationsStore({
      operations: { ...createFakeApi(), ccTailStop, cxTailStop } as unknown as OperationsClient,
      download: { file: vi.fn(), bytes: vi.fn(), open: vi.fn() },
      activeChat: () => ({ execTarget: null, workdir: null, projectId: undefined })
    })
    store.dispose()
    expect(ccTailStop).toHaveBeenCalled()
    expect(cxTailStop).toHaveBeenCalled()
  })
})

describe('voiceStore', () => {
  const settings = {
    micDeviceId: null,
    voice: 'ru',
    handsFree: false,
    bargeIn: false,
    autoSpeak: false,
    diarization: false,
    showConsole: false
  }

  it('gate голосового ввода не пускает запись ни вручную, ни автоматически', () => {
    const store = createVoiceStore({
      stt: { enabled: true, inputEnabled: false },
      tts: { enabled: false },
      getSettings: () => settings
    })
    store.actions.startVoice()
    expect(store.getState().voice).toBe('idle')
    store.dispose()
  })

  it('поздний STT-ответ закрытой записи игнорируется', async () => {
    const onTranscriptFinal = vi.fn()
    const store = createVoiceStore({
      stt: { enabled: true, inputEnabled: true },
      tts: { enabled: false },
      getSettings: () => settings,
      onTranscriptFinal
    })
    await store.actions.applySttFinal({ text: 'привет', segments: [{ speakerId: 1, text: 'привет' }] } as never)
    expect(onTranscriptFinal).not.toHaveBeenCalled()
    expect(store.getState().voice).toBe('idle')
    store.dispose()
  })

  it('переходы автомата: idle → listening → transcribing → thinking', async () => {
    const onTranscriptFinal = vi.fn()
    const store = createVoiceStore({
      stt: { enabled: true, inputEnabled: true },
      tts: { enabled: false },
      getSettings: () => settings,
      onTranscriptFinal
    })
    store.actions.startVoice()
    expect(store.getState().voice).toBe('listening')
    store.actions.stopVoice()
    expect(store.getState().voice).toBe('transcribing')
    await store.actions.applySttFinal({ text: 'привет', segments: [{ speakerId: 1, text: 'привет' }] } as never)
    expect(store.getState().voice).toBe('thinking')
    expect(onTranscriptFinal).toHaveBeenCalledWith({ text: 'привет', segments: [{ speakerId: 1, text: 'привет' }] })
    store.dispose()
  })

  it('dispose освобождает захват и прерывает синтез', () => {
    const stop = vi.fn(async () => {})
    const cancel = vi.fn()
    const store = createVoiceStore({
      voiceInput: { start: vi.fn(async () => {}), stop },
      stt: { enabled: true, inputEnabled: true },
      tts: { enabled: true, speak: vi.fn(), cancel },
      getSettings: () => settings
    })
    store.actions.startVoice()
    store.dispose()
    expect(stop).toHaveBeenCalled()
    expect(cancel).toHaveBeenCalled()
  })
})

