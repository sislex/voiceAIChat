// Стор модуля: состояние списка и все действия над ним. Держится без react
// (getState/subscribe), поэтому его гоняют обычными юнит-тестами, а компонент
// подписывается через useSyncExternalStore.
//
// Отзыв сделан оптимистично: сессия исчезает сразу, а при ошибке возвращается
// на место. Ждать ответа сервера здесь нечестно — человек нажимает «Завершить»
// именно тогда, когда встревожен, и подвисший список читается как отказ.
import { filterSessions, sortSessions, toView, type DeviceSession, type SessionPolicy, type SessionView } from '@voicechat/sessions-core'
import type { SessionsClient, SessionsEvent, SessionsHost, SessionsRealtime } from '../contracts'

export type SessionsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SessionsState {
  status: SessionsStatus
  sessions: DeviceSession[]
  error: string | null
  query: string
  /** Sid, по которому идёт действие: карточка показывает занятость точечно. */
  busySid: string | null
  /** Идёт массовое действие — «выйти на других»/«выйти везде». */
  busyAll: boolean
}

export interface SessionsActions {
  load(): Promise<void>
  reload(): Promise<void>
  setQuery(query: string): void
  revoke(sid: string): Promise<boolean>
  revokeOthers(): Promise<boolean>
  revokeAll(): Promise<boolean>
  rename(sid: string, label: string | null): Promise<boolean>
  setTrusted(sid: string, trusted: boolean): Promise<boolean>
  dispose(): void
}

/** Что умеет конкретный хост: панель прячет действия, которых нет у клиента. */
export interface SessionsCapabilities {
  rename: boolean
  trust: boolean
  revokeOthers: boolean
  revokeAll: boolean
}

export interface SessionsStore {
  capabilities: SessionsCapabilities
  getState(): SessionsState
  subscribe(listener: () => void): () => void
  actions: SessionsActions
  /** Что рисовать: отфильтровано, отсортировано и обогащено признаками. */
  visible(): SessionView[]
  /** Сколько сессий кроме текущей — от этого зависит массовая кнопка. */
  otherCount(): number
}

export interface SessionsStoreOptions {
  client: SessionsClient
  realtime?: SessionsRealtime
  host?: SessionsHost
  /** Куда сообщать об успехе и ошибке: тосты хоста, лог, что угодно. */
  notify?: { success?(message: string): void; error?(message: string): void }
}

const initial = (): SessionsState => ({ status: 'idle', sessions: [], error: null, query: '', busySid: null, busyAll: false })

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function createSessionsStore(options: SessionsStoreOptions): SessionsStore {
  const { client, realtime, host, notify } = options
  let state = initial()
  let disposed = false
  const listeners = new Set<() => void>()
  const now = (): number => host?.now?.() ?? Date.now()
  const policy: Partial<SessionPolicy> | undefined = host?.policy

  const set = (patch: Partial<SessionsState>): void => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  const fail = (error: unknown): false => {
    notify?.error?.(messageOf(error))
    return false
  }

  const read = async (): Promise<void> => {
    try {
      const sessions = await client.list()
      if (disposed) return
      set({ sessions, status: 'ready', error: null })
    } catch (error) {
      if (disposed) return
      set({ status: 'error', error: messageOf(error) })
    }
  }

  /** Общая обёртка мутации: занятость, оптимистичный список, откат при ошибке. */
  const mutate = async (
    key: { sid: string | null; all?: boolean },
    optimistic: (sessions: DeviceSession[]) => DeviceSession[],
    run: () => Promise<void>
  ): Promise<boolean> => {
    const before = state.sessions
    set({ busySid: key.sid, busyAll: Boolean(key.all), sessions: optimistic(before) })
    try {
      await run()
      if (disposed) return true
      set({ busySid: null, busyAll: false })
      // Перечитываем: сервер знает про сессии больше нас (сроки, активность).
      await read()
      return true
    } catch (error) {
      if (disposed) return false
      set({ busySid: null, busyAll: false, sessions: before })
      return fail(error)
    }
  }

  const store: SessionsStore = {
    capabilities: {
      rename: typeof client.rename === 'function',
      trust: typeof client.setTrusted === 'function',
      revokeOthers: typeof client.revokeOthers === 'function',
      revokeAll: typeof client.revokeAll === 'function'
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    visible() {
      return sortSessions(filterSessions(state.sessions, state.query)).map((s) => toView(s, now(), policy))
    },
    otherCount() {
      return state.sessions.filter((s) => !s.current).length
    },
    actions: {
      async load() {
        if (state.status === 'loading') return
        set({ status: 'loading', error: null })
        await read()
      },
      async reload() {
        await read()
      },
      setQuery(query) {
        set({ query })
      },
      async revoke(sid) {
        return mutate({ sid }, (list) => list.filter((s) => s.sid !== sid), () => client.revoke(sid))
      },
      async revokeOthers() {
        if (!client.revokeOthers) return false
        const ok = await mutate({ sid: null, all: true }, (list) => list.filter((s) => s.current), () => client.revokeOthers!())
        if (ok) notify?.success?.('Другие сессии завершены')
        return ok
      },
      async revokeAll() {
        if (!client.revokeAll) return false
        // Список после этого не нужен: хост уводит на экран входа.
        set({ busyAll: true })
        try {
          await client.revokeAll()
          if (!disposed) set({ busyAll: false, sessions: [] })
          host?.onSignedOut?.()
          return true
        } catch (error) {
          if (!disposed) set({ busyAll: false })
          return fail(error)
        }
      },
      async rename(sid, label) {
        if (!client.rename) return false
        return mutate({ sid }, (list) => list.map((s) => (s.sid === sid ? { ...s, label } : s)), () => client.rename!(sid, label))
      },
      async setTrusted(sid, trusted) {
        if (!client.setTrusted) return false
        return mutate(
          { sid },
          (list) => list.map((s) => (s.sid === sid ? { ...s, trustedAt: trusted ? now() : null } : s)),
          () => client.setTrusted!(sid, trusted)
        )
      },
      dispose() {
        disposed = true
        unsubscribe?.()
        listeners.clear()
      }
    }
  }

  const onEvent = (event: SessionsEvent): void => {
    if (disposed) return
    if (event.type === 'sessions.update') {
      void read()
      return
    }
    // Убили конкретную сессию: свою — уходим, чужую — просто обновляем список.
    const own = host?.currentSid ? event.sid === host.currentSid : state.sessions.some((s) => s.sid === event.sid && s.current)
    if (own) {
      notify?.error?.('Вашу сессию завершили на другом устройстве')
      host?.onSignedOut?.()
      return
    }
    set({ sessions: state.sessions.filter((s) => s.sid !== event.sid) })
  }
  const unsubscribe = realtime?.subscribe(onEvent)

  return store
}
