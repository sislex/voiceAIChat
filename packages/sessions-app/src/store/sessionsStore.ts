// Стор модуля: состояние списка и все действия над ним. Держится без react
// (getState/subscribe), поэтому его гоняют обычными юнит-тестами, а компонент
// подписывается через useSyncExternalStore.
//
// Отзыв сделан оптимистично: сессия исчезает сразу, а при ошибке возвращается
// на место. Ждать ответа сервера здесь нечестно — человек нажимает «Завершить»
// именно тогда, когда встревожен, и подвисший список читается как отказ.
import {
  filterSessions, platformsOf, sessionsSummary, sortSessions, toView,
  type DeviceSession, type SessionOrder, type SessionPolicy, type SessionView
} from '@voicechat/sessions-core'
import type { SessionHistoryEvent, SessionsClient, SessionsEvent, SessionsHost, SessionsRealtime } from '../contracts'

export type SessionsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SessionsState {
  status: SessionsStatus
  sessions: DeviceSession[]
  error: string | null
  query: string
  /** Платформа-фильтр (`web`/`desktop`/`agent`); null — показываем все. */
  platform: string | null
  /** Порядок списка: свежесть активности, дата входа или подпись. */
  order: SessionOrder
  /** Когда список прочитан в последний раз; null — ещё не читали. */
  loadedAt: number | null
  /** Отмеченные карточки для массового завершения. */
  selected: string[]
  /** Последнее сообщение о результате действия — его читает скринридер. */
  announcement: string | null
  /** Недавно завершённые сессии; null — ещё не запрашивали. */
  ended: DeviceSession[] | null
  /** История по устройствам: sid → события; null — грузится. */
  history: Record<string, SessionHistoryEvent[] | null>
  /** Sid, по которому идёт действие: карточка показывает занятость точечно. */
  busySid: string | null
  /** Идёт массовое действие — «выйти на других»/«выйти везде». */
  busyAll: boolean
}

export interface SessionsActions {
  load(): Promise<void>
  reload(): Promise<void>
  setQuery(query: string): void
  setPlatform(platform: string | null): void
  setOrder(order: SessionOrder): void
  toggleSelected(sid: string): void
  clearSelected(): void
  revokeSelected(): Promise<boolean>
  copySummary(): Promise<boolean>
  loadEnded(): Promise<void>
  panic(): Promise<boolean>
  loadHistory(sid: string): Promise<void>
  /** Завершить все сессии этого устройства разом. */
  revokeDevice(deviceKey: string): Promise<boolean>
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
  ended: boolean
  panic: boolean
  history: boolean
  copy: boolean
}

export interface SessionsStore {
  capabilities: SessionsCapabilities
  getState(): SessionsState
  subscribe(listener: () => void): () => void
  actions: SessionsActions
  /** Что рисовать: отфильтровано, отсортировано и обогащено признаками. */
  visible(): SessionView[]
  /** Платформы, встреченные в списке: из них строится фильтр. */
  platforms(): string[]
  /** Подписка на «экран снова видно» от хоста; нет хоста — нет подписки. */
  onVisible?(cb: () => void): () => void
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

const initial = (): SessionsState => ({
  status: 'idle', sessions: [], error: null, query: '', platform: null, order: 'activity',
  loadedAt: null, selected: [], announcement: null, ended: null, history: {}, busySid: null, busyAll: false
})

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
      // Выбор чистим от исчезнувших сессий: иначе «завершить выбранные»
      // молча промахивается по уже отозванным.
      const alive = new Set(sessions.map((s) => s.sid))
      set({ sessions, status: 'ready', error: null, loadedAt: now(), selected: state.selected.filter((sid) => alive.has(sid)) })
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
      revokeAll: typeof client.revokeAll === 'function',
      ended: typeof client.listEnded === 'function',
      panic: typeof client.panic === 'function',
      history: typeof client.history === 'function',
      copy: typeof host?.copy === 'function'
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    visible() {
      const byPlatform = state.platform ? state.sessions.filter((s) => s.platform === state.platform) : state.sessions
      return sortSessions(filterSessions(byPlatform, state.query), state.order).map((s) => toView(s, now(), policy, state.sessions))
    },
    platforms() {
      return platformsOf(state.sessions)
    },
    ...(host?.onVisible ? { onVisible: (cb: () => void) => host.onVisible!(cb) } : {}),
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
      setPlatform(platform) {
        set({ platform })
      },
      setOrder(order) {
        set({ order })
      },
      toggleSelected(sid) {
        const selected = state.selected.includes(sid) ? state.selected.filter((s) => s !== sid) : [...state.selected, sid]
        set({ selected })
      },
      clearSelected() {
        set({ selected: [] })
      },
      async revokeSelected() {
        const victims = state.selected.filter((sid) => state.sessions.some((s) => s.sid === sid && !s.current))
        if (victims.length === 0) return false
        set({ busyAll: true, sessions: state.sessions.filter((s) => !victims.includes(s.sid)) })
        try {
          for (const sid of victims) await client.revoke(sid)
          if (!disposed) set({ busyAll: false, selected: [], announcement: `Завершено сессий: ${victims.length}` })
          await read()
          return true
        } catch (error) {
          if (!disposed) set({ busyAll: false })
          await read()
          return fail(error)
        }
      },
      async copySummary() {
        if (!host?.copy) return false
        try {
          await host.copy(sessionsSummary(state.sessions, now()))
          if (!disposed) set({ announcement: 'Сводка сессий скопирована' })
          return true
        } catch (error) {
          return fail(error)
        }
      },
      async loadHistory(sid) {
        if (!client.history || state.history[sid] !== undefined) return
        set({ history: { ...state.history, [sid]: null } })
        try {
          const events = await client.history(sid)
          if (!disposed) set({ history: { ...state.history, [sid]: events } })
        } catch (error) {
          if (!disposed) set({ history: { ...state.history, [sid]: [] } })
          notify?.error?.(messageOf(error))
        }
      },
      async revokeDevice(deviceKey) {
        // Отзываем по одной: массового роута нет, а последовательные вызовы
        // честнее «атомарного» обещания, которого сервер не даёт.
        const victims = state.sessions.filter((s) => s.deviceKey === deviceKey && !s.current)
        if (victims.length === 0) return false
        set({ busyAll: true, sessions: state.sessions.filter((s) => !victims.includes(s)) })
        try {
          for (const victim of victims) await client.revoke(victim.sid)
          if (!disposed) set({ busyAll: false })
          await read()
          return true
        } catch (error) {
          if (!disposed) set({ busyAll: false })
          await read()
          return fail(error)
        }
      },
      async loadEnded() {
        if (!client.listEnded) return
        try {
          const ended = await client.listEnded()
          if (!disposed) set({ ended })
        } catch (error) {
          // Завершённые — справка, а не основной список: молча оставляем пустым,
          // чтобы сбой второстепенного запроса не ломал рабочий экран.
          notify?.error?.(messageOf(error))
        }
      },
      async panic() {
        if (!client.panic) return false
        set({ busyAll: true })
        try {
          await client.panic()
          if (!disposed) set({ busyAll: false, sessions: [], ended: null })
          host?.onSignedOut?.()
          return true
        } catch (error) {
          if (!disposed) set({ busyAll: false })
          return fail(error)
        }
      },
      async revoke(sid) {
        const title = state.sessions.find((s) => s.sid === sid)?.label ?? ''
        const ok = await mutate({ sid }, (list) => list.filter((s) => s.sid !== sid), () => client.revoke(sid))
        if (ok && !disposed) set({ announcement: title ? `Сессия «${title}» завершена` : 'Сессия завершена' })
        return ok
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
