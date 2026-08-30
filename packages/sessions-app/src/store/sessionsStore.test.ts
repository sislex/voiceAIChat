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
    expect(store.capabilities).toEqual({ rename: true, trust: true, revokeOthers: true, revokeAll: true, ended: false, panic: false })
  })

  it('урезанный клиент (админка) объявляет только чтение и отзыв', () => {
    const store = createSessionsStore({ client: { list: async () => [], revoke: async () => undefined } })
    expect(store.capabilities).toEqual({ rename: false, trust: false, revokeOthers: false, revokeAll: false, ended: false, panic: false })
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

