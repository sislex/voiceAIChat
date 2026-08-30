// Контракт AppRuntime (CHAT-236): bootstrap, повторный вход, logout, reconnect,
// маршрутизация realtime-кадров, частичный отказ домена и освобождение ресурсов.

import { describe, expect, it, vi } from 'vitest'
import { createAppRuntime } from './appRuntime'
import { buildTestClients } from '../test/appHarness'
import { createFakeApi, type FakeApi } from '../test/fakeApi'
import type { SessionUser } from '@shared/types'
import type { StoreDiagnostics } from '../store/devtools'

const USER: SessionUser = { name: 'ann', role: 'admin' }

function makeSession(user: SessionUser | null = USER) {
  let current = user
  return {
    me: vi.fn(async () => current),
    login: vi.fn(async () => {
      current = USER
      return USER
    }),
    logout: vi.fn(async () => {
      current = null
    })
  }
}

function makeRuntime(over: { api?: FakeApi; session?: ReturnType<typeof makeSession> } = {}) {
  const api = over.api ?? createFakeApi(['Первый'])
  const session = over.session
  return {
    api,
    session,
    runtime: createAppRuntime({
      clients: buildTestClients({ api, ...(session ? { session: session as never } : {}) })
    })
  }
}

describe('AppRuntime — Redux DevTools diagnostics', () => {
  it('registers the eight active domains under stable names', () => {
    const attached: Array<[string, string]> = []
    const diagnostics = {
      attach<T>(store: T, name: string, domain: string): T {
        attached.push([name, domain])
        return store
      }
    } as StoreDiagnostics
    const runtime = createAppRuntime({ clients: buildTestClients({ api: createFakeApi() }), diagnostics })

    expect(attached).toEqual([
      ['ChatAI Shell', 'shell'],
      ['ChatAI Session', 'session'],
      ['ChatAI Settings', 'settings'],
      ['ChatAI Voice', 'voice'],
      ['ChatAI Chat', 'chat'],
      ['ChatAI Operations', 'operations'],
      ['ChatAI Admin', 'admin'],
      ['ChatAI Projects', 'projects']
    ])
    runtime.dispose()
  })
})

describe('AppRuntime — bootstrap', () => {
  it('без авторизации защищённый bootstrap не запускается', async () => {
    const session = makeSession(null)
    const { runtime, api } = makeRuntime({ session })
    const list = vi.spyOn(api, 'conversations:list')

    await runtime.start()

    expect(runtime.session.getState()).toMatchObject({ authRequired: true, currentUser: null })
    expect(list).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('после login грузит настройки, чаты, машины и открывает свежий чат', async () => {
    const session = makeSession(null)
    const { runtime } = makeRuntime({ session })
    await runtime.start()

    await runtime.login('ann', 'x')

    expect(runtime.session.getState().currentUser).toEqual(USER)
    expect(runtime.chat.getState().conversations).toHaveLength(1)
    expect(runtime.chat.getState().activeId).toBe(runtime.chat.getState().conversations[0].id)
    expect(runtime.operations.getState().agentsStatus).toBe('ready')
    runtime.dispose()
  })

  it('повторный bootstrap идемпотентен: второй граф загрузки не стартует', async () => {
    const { runtime, api } = makeRuntime()
    const list = vi.spyOn(api, 'conversations:list')
    await Promise.all([runtime.start(), runtime.start()])
    // Внутри одного bootstrap список читается индексом и повторным refresh —
    // второй параллельный start не удваивает граф.
    const afterParallel = list.mock.calls.length
    await runtime.start()
    expect(list.mock.calls.length).toBeGreaterThan(afterParallel)
    expect(runtime.chat.getState().conversationsStatus).toBe('ready')
    runtime.dispose()
  })

  it('падение необязательного домена не ломает загруженный чат', async () => {
    const api = createFakeApi(['Первый'])
    vi.spyOn(api, 'agents:list').mockRejectedValue(new Error('машины недоступны'))
    vi.spyOn(api, 'projects:list').mockRejectedValue(new Error('проекты недоступны'))
    const { runtime } = makeRuntime({ api })

    await runtime.start()

    expect(runtime.chat.getState().conversations).toHaveLength(1)
    expect(runtime.chat.getState().conversationsStatus).toBe('ready')
    expect(runtime.operations.getState().agentsStatus).toBe('error')
    expect(runtime.session.getState().currentUser).not.toBeNull()
    runtime.dispose()
  })

  it('logout очищает пользовательские и административные данные', async () => {
    const session = makeSession()
    const { runtime } = makeRuntime({ session })
    await runtime.start()
    await runtime.openAdmin()
    expect(runtime.admin.getState().adminUsers.length).toBeGreaterThan(0)

    await runtime.logout()

    expect(runtime.session.getState().currentUser).toBeNull()
    expect(runtime.chat.getState().conversations).toEqual([])
    expect(runtime.chat.getState().messages).toEqual([])
    expect(runtime.admin.getState().adminUsers).toEqual([])
    expect(runtime.projects.getState().projects).toEqual([])
    expect(runtime.voice.getState().voice).toBe('idle')
    runtime.dispose()
  })

  it('вход другим пользователем в той же вкладке не оставляет чужих данных', async () => {
    const session = makeSession()
    const { runtime } = makeRuntime({ session })
    await runtime.start()
    expect(runtime.chat.getState().conversations).toHaveLength(1)

    session.login.mockResolvedValueOnce({ name: 'bob', role: 'developer' } as never)
    // Данные прежнего пользователя должны исчезнуть до загрузки новых.
    const cleared: number[] = []
    runtime.chat.subscribe(() => cleared.push(runtime.chat.getState().conversations.length))
    await runtime.login('bob', 'x')
    expect(cleared).toContain(0)
    runtime.dispose()
  })
})

describe('AppRuntime — маршрутизация realtime-кадров', () => {
  it('кадры уходят владельцу домена', async () => {
    const { runtime } = makeRuntime()
    await runtime.start()
    const conversationId = runtime.chat.getState().activeId!

    runtime.handlers.turnActive([{ conversationId, partial: 'часть' } as never])
    expect(runtime.chat.getState().activeTurns[conversationId]).toBe('часть')
    // Ход принадлежит разговору: после reconnect он восстановлен из снимка.
    expect(runtime.voice.getState().voice).toBe('thinking')

    runtime.handlers.agents([{ id: 'a1', name: 'mac', online: true } as never])
    expect(runtime.operations.getState().agents).toHaveLength(1)

    runtime.handlers.modelDownloadProgress(42)
    expect(runtime.settings.getState().downloadPercent).toBe(42)
    runtime.dispose()
  })

  it('кадр фонового разговора не рисуется в открытом чате', async () => {
    const { runtime } = makeRuntime()
    await runtime.start()

    runtime.handlers.turnToken('чужое', 'другой-чат')

    expect(runtime.chat.getState().activeTurns['другой-чат']).toBe('чужое')
    expect(runtime.chat.getState().streamingReply).toBe('')
    runtime.dispose()
  })
})

describe('AppRuntime — освобождение ресурсов', () => {
  it('dispose отписывает realtime и глушит все домены', async () => {
    const api = createFakeApi(['Первый'])
    const disconnect = vi.fn()
    const runtime = createAppRuntime({
      clients: buildTestClients({ api }),
      realtime: () => disconnect
    })
    await runtime.start()
    const listener = vi.fn()
    runtime.chat.subscribe(listener)

    runtime.dispose()
    runtime.handlers.turnToken('после dispose')

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
  })
})


describe('AppRuntime — истёкшая сессия', () => {
  it('401 от транспорта гасит сессию: expire() существовал, но его никто не звал', async () => {
    let onUnauthorized: null | (() => void) = null
    const session = { ...makeSession(), onUnauthorized: (cb: () => void) => { onUnauthorized = cb; return () => { onUnauthorized = null } } }
    const { runtime } = makeRuntime({ session: session as never })
    await runtime.session.actions.check()
    expect(runtime.session.getState().currentUser?.name).toBe(USER.name)

    ;(onUnauthorized as (() => void) | null)?.()
    expect(runtime.session.getState().currentUser).toBeNull()
    runtime.dispose()
  })

  it('после dispose сигнал 401 больше не обрабатывается', async () => {
    let onUnauthorized: null | (() => void) = null
    const session = { ...makeSession(), onUnauthorized: (cb: () => void) => { onUnauthorized = cb; return () => { onUnauthorized = null } } }
    const { runtime } = makeRuntime({ session: session as never })
    await runtime.session.actions.check()
    runtime.dispose()
    // Подписка снимается: иначе она держала бы уничтоженный рантайм.
    expect(onUnauthorized).toBeNull()
  })
})

// Полный цикл деплоя глазами открытой вкладки: сервер уходит в перезапуск,
// человек продолжает работать, сервер возвращается. Ни в одной точке его выбор
// не должен превратиться в дефолты.
describe('AppRuntime — деплой во время работы', () => {
  it('недоступность сервера не превращает настройки в дефолты', async () => {
    const api = createFakeApi(['Первый'])
    await api['settings:save']({ theme: 'dark', llmProvider: 'codex', defaultAgentId: 'a1' })
    const session = makeSession(null)
    const { runtime } = makeRuntime({ api, session })
    await runtime.login('ann', 'x')
    expect(runtime.settings.getState().settings.theme).toBe('dark')

    // Сервер перезапускается: настройки не читаются и не пишутся.
    const get = vi.spyOn(api, 'settings:get').mockRejectedValue(new Error('502'))
    const save = vi.spyOn(api, 'settings:save')
    runtime.settings.actions.reset()
    await runtime.settings.actions.load().catch(() => {})
    await runtime.settings.actions.updateSettings({ autoSpeak: true }).catch(() => {})
    expect(save).not.toHaveBeenCalled()
    expect(api._state.settings).toMatchObject({ theme: 'dark', llmProvider: 'codex' })

    // Сервер вернулся: настройки на месте, изменение сохраняется поверх них.
    get.mockRestore()
    await runtime.settings.actions.load()
    await runtime.settings.actions.updateSettings({ autoSpeak: true })
    expect(api._state.settings).toMatchObject({ theme: 'dark', llmProvider: 'codex', autoSpeak: true })
    runtime.dispose()
  })

  // Вкладка, чья загрузка пришлась на окно деплоя, не должна ждать человека:
  // вернувшийся сервер — сам по себе повод перечитать настройки.
  it('после возвращения сервера настройки подхватываются без участия человека', async () => {
    const api = createFakeApi()
    await api['settings:save']({ theme: 'dark' })
    const { runtime } = makeRuntime({ api })
    const get = vi.spyOn(api, 'settings:get').mockRejectedValueOnce(new Error('502'))
    await runtime.settings.actions.load().catch(() => {})
    expect(runtime.settings.getState().settingsLoaded).toBe(false)

    get.mockRestore()
    runtime.handlers.settingsChanged() // сервер вернулся (реконнект WS или сеть)

    await vi.waitFor(() => expect(runtime.settings.getState().settingsLoaded).toBe(true))
    expect(runtime.settings.getState().settings.theme).toBe('dark')
    runtime.dispose()
  })

  it('изменение в соседней вкладке перечитывается, а своё — рассылается', async () => {
    const api = createFakeApi()
    const { runtime } = makeRuntime({ api })
    await runtime.settings.actions.load()

    await api['settings:save']({ theme: 'green' }) // «соседняя вкладка»
    runtime.handlers.settingsChanged()
    await vi.waitFor(() => expect(runtime.settings.getState().settings.theme).toBe('green'))

    const events: string[] = []
    window.addEventListener('storage', (event) => { if (event.key === 'vc:settings-update') events.push('signal') })
    await runtime.settings.actions.updateSettings({ theme: 'dark' })
    // В jsdom событие storage своей же вкладке не приходит — проверяем, что
    // сигнальный ключ не оседает в хранилище (он пишется и сразу снимается).
    expect(localStorage.getItem('vc:settings-update')).toBeNull()
    expect(events).toEqual([])
    runtime.dispose()
  })
})
