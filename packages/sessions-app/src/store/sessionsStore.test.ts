import { describe, expect, it, vi } from 'vitest'
import type { DeviceSession } from '@voicechat/sessions-core'
import { createSessionsStore } from './sessionsStore'
import type { SessionsClient, SessionsEvent } from '../contracts'
import { FIXTURE_NOW, makeSession, makeSessions } from '../fixtures'

function clientOf(sessions: DeviceSession[], over: Partial<SessionsClient> = {}): SessionsClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    list: async () => { calls.push('list'); return [...sessions] },
    revoke: async (sid) => { calls.push(`revoke:${sid}`) },
    revokeOthers: async () => { calls.push('revokeOthers') },
    revokeAll: async () => { calls.push('revokeAll') },
    rename: async (sid, label) => { calls.push(`rename:${sid}:${label}`) },
    setTrusted: async (sid, trusted) => { calls.push(`trust:${sid}:${trusted}`) },
    ...over
  }
}

describe('createSessionsStore: чтение', () => {
  it('загружает список и сообщает о возможностях клиента', async () => {
    const store = createSessionsStore({ client: clientOf(makeSessions()) })
    expect(store.getState().status).toBe('idle')
    await store.actions.load()
    expect(store.getState().status).toBe('ready')
    expect(store.getState().sessions).toHaveLength(4)
    expect(store.capabilities).toEqual({ rename: true, trust: true, revokeOthers: true, revokeAll: true, ended: false, panic: false, history: false, copy: false })
  })

  it('урезанный клиент (админка) объявляет только чтение и отзыв', () => {
    const store = createSessionsStore({ client: { list: async () => [], revoke: async () => undefined } })
    expect(store.capabilities).toEqual({ rename: false, trust: false, revokeOthers: false, revokeAll: false, ended: false, panic: false, history: false, copy: false })
  })

  it('ошибка чтения переводит в error и сохраняет текст для ErrorState', async () => {
    const store = createSessionsStore({ client: clientOf([], { list: async () => { throw new Error('сервер недоступен') } }) })
    await store.actions.load()
    expect(store.getState()).toMatchObject({ status: 'error', error: 'сервер недоступен' })
  })

  it('visible(): текущая первой, фильтр по запросу, признаки из ядра', async () => {
    const store = createSessionsStore({ client: clientOf(makeSessions()), host: { now: () => FIXTURE_NOW } })
    await store.actions.load()
    expect(store.visible().map((v) => v.session.sid)).toEqual(['current', 'phone', 'work', 'legacy'])
    expect(store.visible()[0]).toMatchObject({ current: true, online: true, place: 'Москва, RU' })
    expect(store.visible().find((v) => v.session.sid === 'work')).toMatchObject({ trusted: true, title: 'Рабочий ноут' })
    store.actions.setQuery('казань')
    expect(store.visible().map((v) => v.session.sid)).toEqual(['phone'])
    expect(store.otherCount()).toBe(3)
  })
})

describe('createSessionsStore: мутации', () => {
  it('отзыв убирает сессию сразу и перечитывает список после ответа', async () => {
    const sessions = makeSessions()
    const client = clientOf(sessions, {
      revoke: async (sid) => {
        const index = sessions.findIndex((s) => s.sid === sid)
        sessions.splice(index, 1)
      }
    })
    const store = createSessionsStore({ client })
    await store.actions.load()
    const pending = store.actions.revoke('phone')
    // Ещё до ответа сервера карточки уже нет: ожидание читалось бы как отказ.
    expect(store.getState().sessions.map((s) => s.sid)).not.toContain('phone')
    expect(store.getState().busySid).toBe('phone')
    await pending
    expect(store.getState().busySid).toBeNull()
    expect(client.calls.filter((c) => c === 'list')).toHaveLength(2)
  })

  it('ошибка отзыва возвращает сессию на место и сообщает хосту', async () => {
    const error = vi.fn()
    const store = createSessionsStore({
      client: clientOf(makeSessions(), { revoke: async () => { throw new Error('нет доступа') } }),
      notify: { error }
    })
    await store.actions.load()
    expect(await store.actions.revoke('phone')).toBe(false)
    expect(store.getState().sessions.map((s) => s.sid)).toContain('phone')
    expect(store.getState().busySid).toBeNull()
    expect(error).toHaveBeenCalledWith('нет доступа')
  })

  it('«выйти на других» оставляет текущую и сообщает об успехе', async () => {
    const sessions = makeSessions()
    const success = vi.fn()
    const client = clientOf(sessions, { revokeOthers: async () => { sessions.splice(0, sessions.length, sessions[0]!) } })
    const store = createSessionsStore({ client, notify: { success } })
    await store.actions.load()
    await store.actions.revokeOthers()
    expect(store.getState().sessions.map((s) => s.sid)).toEqual(['current'])
    expect(success).toHaveBeenCalledWith('Другие сессии завершены')
  })

  it('«выйти везде» очищает список и уводит хост на экран входа', async () => {
    const onSignedOut = vi.fn()
    const store = createSessionsStore({ client: clientOf(makeSessions()), host: { onSignedOut } })
    await store.actions.load()
    await store.actions.revokeAll()
    expect(store.getState().sessions).toEqual([])
    expect(onSignedOut).toHaveBeenCalled()
  })

  it('переименование и доверие применяются оптимистично', async () => {
    const client = clientOf(makeSessions())
    const store = createSessionsStore({ client, host: { now: () => FIXTURE_NOW } })
    await store.actions.load()
    const rename = store.actions.rename('phone', 'Телефон')
    expect(store.getState().sessions.find((s) => s.sid === 'phone')?.label).toBe('Телефон')
    await rename
    const trust = store.actions.setTrusted('phone', true)
    expect(store.getState().sessions.find((s) => s.sid === 'phone')?.trustedAt).toBe(FIXTURE_NOW)
    await trust
    expect(client.calls).toContain('rename:phone:Телефон')
    expect(client.calls).toContain('trust:phone:true')
  })

  it('действия, которых клиент не умеет, возвращают false и не бросают', async () => {
    const store = createSessionsStore({ client: { list: async () => [makeSession()], revoke: async () => undefined } })
    await store.actions.load()
    expect(await store.actions.rename('a', 'x')).toBe(false)
    expect(await store.actions.setTrusted('a', true)).toBe(false)
    expect(await store.actions.revokeOthers()).toBe(false)
    expect(await store.actions.revokeAll()).toBe(false)
  })
})

describe('createSessionsStore: живые события', () => {
  const realtimeOf = () => {
    const listeners = new Set<(e: SessionsEvent) => void>()
    return {
      emit: (event: SessionsEvent) => { for (const l of listeners) l(event) },
      subscribe: (listener: (e: SessionsEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) }
    }
  }

  it('sessions.update перечитывает список', async () => {
    const realtime = realtimeOf()
    const client = clientOf(makeSessions())
    const store = createSessionsStore({ client, realtime })
    await store.actions.load()
    realtime.emit({ type: 'sessions.update' })
    await vi.waitFor(() => expect(client.calls.filter((c) => c === 'list')).toHaveLength(2))
  })

  it('чужую сессию убирает из списка, свою — превращает в выход', async () => {
    const realtime = realtimeOf()
    const onSignedOut = vi.fn()
    const error = vi.fn()
    const store = createSessionsStore({ client: clientOf(makeSessions()), realtime, host: { currentSid: 'current', onSignedOut }, notify: { error } })
    await store.actions.load()
    realtime.emit({ type: 'session.revoked', sid: 'phone' })
    expect(store.getState().sessions.map((s) => s.sid)).not.toContain('phone')
    expect(onSignedOut).not.toHaveBeenCalled()
    realtime.emit({ type: 'session.revoked', sid: 'current' })
    expect(onSignedOut).toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Вашу сессию завершили на другом устройстве')
  })

  it('свою сессию узнаёт по флагу current, когда хост не сообщил sid', async () => {
    const realtime = realtimeOf()
    const onSignedOut = vi.fn()
    const store = createSessionsStore({ client: clientOf(makeSessions()), realtime, host: { onSignedOut } })
    await store.actions.load()
    realtime.emit({ type: 'session.revoked', sid: 'current' })
    expect(onSignedOut).toHaveBeenCalled()
  })

  it('после dispose события игнорируются и подписка снята', async () => {
    const realtime = realtimeOf()
    const client = clientOf(makeSessions())
    const store = createSessionsStore({ client, realtime })
    await store.actions.load()
    store.actions.dispose()
    realtime.emit({ type: 'sessions.update' })
    expect(client.calls.filter((c) => c === 'list')).toHaveLength(1)
  })
})

describe('createSessionsStore: завершённые, паника и фильтр по платформе', () => {
  const ended = [makeSession({ sid: 'gone', ended: true, endedAt: FIXTURE_NOW - 60_000 })]

  it('завершённые грузятся отдельно и только по запросу', async () => {
    const listEnded = vi.fn(async () => ended)
    const store = createSessionsStore({ client: clientOf(makeSessions(), { listEnded }) })
    await store.actions.load()
    expect(store.getState().ended).toBeNull()
    expect(listEnded).not.toHaveBeenCalled()
    await store.actions.loadEnded()
    expect(store.getState().ended?.map((s) => s.sid)).toEqual(['gone'])
  })

  it('сбой запроса завершённых не ломает основной список', async () => {
    const error = vi.fn()
    const store = createSessionsStore({
      client: clientOf(makeSessions(), { listEnded: async () => { throw new Error('502') } }),
      notify: { error }
    })
    await store.actions.load()
    await store.actions.loadEnded()
    expect(store.getState().status).toBe('ready')
    expect(store.getState().sessions).toHaveLength(4)
    expect(error).toHaveBeenCalledWith('502')
  })

  it('«это не я» очищает список и уводит на экран входа', async () => {
    const panic = vi.fn(async () => undefined)
    const onSignedOut = vi.fn()
    const store = createSessionsStore({ client: clientOf(makeSessions(), { panic }), host: { onSignedOut } })
    await store.actions.load()
    expect(store.capabilities.panic).toBe(true)
    expect(await store.actions.panic()).toBe(true)
    expect(panic).toHaveBeenCalled()
    expect(store.getState().sessions).toEqual([])
    expect(onSignedOut).toHaveBeenCalled()
  })

  it('фильтр по платформе сужает список и снимается повторным выбором', async () => {
    const sessions = [
      makeSession({ sid: 'web', platform: 'web' }),
      makeSession({ sid: 'app', platform: 'desktop' })
    ]
    const store = createSessionsStore({ client: clientOf(sessions), host: { now: () => FIXTURE_NOW } })
    await store.actions.load()
    expect(store.platforms()).toEqual(['desktop', 'web'])
    store.actions.setPlatform('desktop')
    expect(store.visible().map((v) => v.session.sid)).toEqual(['app'])
    store.actions.setPlatform(null)
    expect(store.visible()).toHaveLength(2)
  })

  it('карточка знает о соседних сессиях того же устройства', async () => {
    const sessions = [
      makeSession({ sid: 'a', deviceKey: 'same' }),
      makeSession({ sid: 'b', deviceKey: 'same' }),
      makeSession({ sid: 'c', deviceKey: 'other' })
    ]
    const store = createSessionsStore({ client: clientOf(sessions), host: { now: () => FIXTURE_NOW } })
    await store.actions.load()
    expect(store.visible().find((v) => v.session.sid === 'a')?.siblings).toBe(1)
    expect(store.visible().find((v) => v.session.sid === 'c')?.siblings).toBe(0)
  })
})

describe('createSessionsStore: история, отзыв устройства и сигнал видимости', () => {
  it('история грузится один раз на устройство и переживает ошибку', async () => {
    const history = vi.fn(async (sid: string) => [{ id: 1, at: FIXTURE_NOW, type: 'login', details: sid }])
    const store = createSessionsStore({ client: clientOf(makeSessions(), { history }) })
    await store.actions.load()
    expect(store.capabilities.history).toBe(true)
    await store.actions.loadHistory('phone')
    expect(store.getState().history.phone?.[0]?.details).toBe('phone')
    await store.actions.loadHistory('phone')
    expect(history).toHaveBeenCalledTimes(1)

    const failing = createSessionsStore({ client: clientOf(makeSessions(), { history: async () => { throw new Error('нет') } }) })
    await failing.actions.load()
    await failing.actions.loadHistory('phone')
    // Пустой массив, а не «вечная загрузка»: иначе раздел висит спиннером.
    expect(failing.getState().history.phone).toEqual([])
  })

  it('отзыв устройства гасит все его сессии, кроме текущей', async () => {
    const sessions = [
      makeSession({ sid: 'current', deviceKey: 'same', current: true }),
      makeSession({ sid: 'a', deviceKey: 'same' }),
      makeSession({ sid: 'b', deviceKey: 'same' }),
      makeSession({ sid: 'other', deviceKey: 'another' })
    ]
    const revoked: string[] = []
    const client = clientOf(sessions, {
      revoke: async (sid) => { revoked.push(sid); const i = sessions.findIndex((s) => s.sid === sid); sessions.splice(i, 1) }
    })
    const store = createSessionsStore({ client })
    await store.actions.load()
    expect(await store.actions.revokeDevice('same')).toBe(true)
    expect(revoked.sort()).toEqual(['a', 'b'])
    expect(store.getState().sessions.map((s) => s.sid).sort()).toEqual(['current', 'other'])
    // Устройства без соседей отзывать нечего.
    expect(await store.actions.revokeDevice('another-missing')).toBe(false)
  })

  it('сигнал «экран снова видно» перечитывает список', async () => {
    // Держим подписчика в объекте: с обычным let TypeScript сужает тип до null.
    const bus: { notify: (() => void) | null } = { notify: null }
    const client = clientOf(makeSessions())
    const store = createSessionsStore({ client, host: { onVisible: (cb) => { bus.notify = cb; return () => { bus.notify = null } } } })
    await store.actions.load()
    expect(client.calls.filter((c) => c === 'list')).toHaveLength(1)
    // Подписывается панель — здесь повторяем ровно её вызов.
    store.onVisible?.(() => void store.actions.reload())
    bus.notify?.()
    await vi.waitFor(() => expect(client.calls.filter((c) => c === 'list').length).toBeGreaterThan(1))
  })
})

describe('createSessionsStore: порядок, выбор, сводка и объявления', () => {
  it('порядок списка переключается и текущая остаётся первой', async () => {
    const sessions = [
      makeSession({ sid: 'старая', lastSeen: FIXTURE_NOW - 5 * 86_400_000, createdAt: FIXTURE_NOW - 86_400_000 }),
      makeSession({ sid: 'свежая', lastSeen: FIXTURE_NOW, createdAt: FIXTURE_NOW - 10 * 86_400_000 }),
      makeSession({ sid: 'текущая', current: true, lastSeen: FIXTURE_NOW - 86_400_000 })
    ]
    const store = createSessionsStore({ client: clientOf(sessions), host: { now: () => FIXTURE_NOW } })
    await store.actions.load()
    expect(store.visible().map((v) => v.session.sid)).toEqual(['текущая', 'свежая', 'старая'])
    store.actions.setOrder('created')
    expect(store.visible().map((v) => v.session.sid)).toEqual(['текущая', 'старая', 'свежая'])
  })

  it('отметка времени чтения обновляется при каждой загрузке', async () => {
    let clock = FIXTURE_NOW
    const store = createSessionsStore({ client: clientOf(makeSessions()), host: { now: () => clock } })
    await store.actions.load()
    expect(store.getState().loadedAt).toBe(FIXTURE_NOW)
    clock = FIXTURE_NOW + 60_000
    await store.actions.reload()
    expect(store.getState().loadedAt).toBe(FIXTURE_NOW + 60_000)
  })

  it('выбранные сессии завершаются пачкой, текущая в пачку не попадает', async () => {
    const sessions = makeSessions()
    const revoked: string[] = []
    const client = clientOf(sessions, {
      revoke: async (sid) => { revoked.push(sid); sessions.splice(sessions.findIndex((s) => s.sid === sid), 1) }
    })
    const store = createSessionsStore({ client })
    await store.actions.load()
    store.actions.toggleSelected('phone')
    store.actions.toggleSelected('work')
    store.actions.toggleSelected('current')
    expect(store.getState().selected).toHaveLength(3)
    expect(await store.actions.revokeSelected()).toBe(true)
    expect(revoked.sort()).toEqual(['phone', 'work'])
    expect(store.getState().selected).toEqual([])
    expect(store.getState().announcement).toBe('Завершено сессий: 2')
  })

  it('повторная отметка снимает выбор, а исчезнувшие сессии из выбора вычищаются', async () => {
    const sessions = makeSessions()
    const client = clientOf(sessions)
    const store = createSessionsStore({ client })
    await store.actions.load()
    store.actions.toggleSelected('phone')
    store.actions.toggleSelected('phone')
    expect(store.getState().selected).toEqual([])
    store.actions.toggleSelected('phone')
    sessions.splice(sessions.findIndex((s) => s.sid === 'phone'), 1)
    await store.actions.reload()
    expect(store.getState().selected).toEqual([])
  })

  it('сводка уходит в буфер через порт хоста', async () => {
    const copied: string[] = []
    const store = createSessionsStore({
      client: clientOf(makeSessions()),
      host: { now: () => FIXTURE_NOW, copy: (text) => { copied.push(text) } }
    })
    await store.actions.load()
    expect(store.capabilities.copy).toBe(true)
    expect(await store.actions.copySummary()).toBe(true)
    expect(copied[0]).toContain('Сессии (4)')
    expect(store.getState().announcement).toBe('Сводка сессий скопирована')
    // Без порта возможности нет и действие честно отвечает отказом.
    const bare = createSessionsStore({ client: clientOf(makeSessions()) })
    expect(bare.capabilities.copy).toBe(false)
    expect(await bare.actions.copySummary()).toBe(false)
  })

  it('точечный отзыв объявляет результат словами', async () => {
    const sessions = makeSessions()
    const store = createSessionsStore({ client: clientOf(sessions, { revoke: async (sid) => { sessions.splice(sessions.findIndex((s) => s.sid === sid), 1) } }) })
    await store.actions.load()
    await store.actions.revoke('work')
    expect(store.getState().announcement).toBe('Сессия «Рабочий ноут» завершена')
  })
})

