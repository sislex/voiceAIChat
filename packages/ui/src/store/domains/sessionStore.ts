// sessionStore — авторизация и текущий пользователь (CHAT-236).
//
// Разговоры, машины, настройки и админские данные он не грузит: после входа
// защищённый bootstrap запускает AppRuntime, а сюда приходит только событие.

import type { SessionUser } from '@shared/types'
import type { SessionClient } from '../../clients/types'
import { createStoreCore, type Store } from '../createStore'

export interface SessionState {
  /** Требуется ли вход (есть клиент сессии — web). false в desktop → без логина. */
  authRequired: boolean
  /** Текущий пользователь; null при authRequired → показываем экран логина. */
  currentUser: SessionUser | null
  /** Ошибка последнего логина (для формы). */
  authError: string | null
  /** Идёт ли проверка сохранённой сессии (`/me`). */
  checking: boolean
}

/** События сессии, на которые реагирует AppRuntime. */
export type SessionEvent =
  | { type: 'session.authenticated'; user: SessionUser }
  | { type: 'session.userChanged'; user: SessionUser; previous: SessionUser | null }
  | { type: 'session.signedOut' }
  | { type: 'session.expired' }

export interface SessionActions {
  /** Проверить сохранённую сессию. Возвращает пользователя или null. */
  check(): Promise<SessionUser | null>
  /** Войти по логину/паролю (web). */
  login(name: string, password: string): Promise<SessionUser | null>
  /** Выйти: закрыть сессию на сервере и показать экран логина. */
  logout(): Promise<void>
  /** Сессия истекла/потеряна (сервер ответил 401). */
  expire(): void
  /** Подписка на события домена (её слушает AppRuntime). */
  onEvent(listener: (event: SessionEvent) => void): () => void
}

export type SessionStore = Store<SessionState, SessionActions>

export interface SessionDeps {
  /** Клиент сессии. Отсутствует (desktop) → аутентификация не требуется. */
  session?: SessionClient
}

function initialState(authRequired: boolean): SessionState {
  return { authRequired, currentUser: null, authError: null, checking: false }
}

export function createSessionStore(deps: SessionDeps = {}): SessionStore {
  const client = deps.session
  const core = createStoreCore<SessionState>(initialState(!!client))
  const { getState, setState } = core
  const listeners = new Set<(event: SessionEvent) => void>()

  function emit(event: SessionEvent): void {
    for (const listener of [...listeners]) listener(event)
  }

  function apply(user: SessionUser): void {
    const previous = getState().currentUser
    setState({ currentUser: user, authError: null })
    emit({ type: 'session.authenticated', user })
    // Вход другим пользователем в той же вкладке обязан очистить чужие данные.
    if (previous && previous.name !== user.name) emit({ type: 'session.userChanged', user, previous })
  }

  return {
    getState,
    subscribe: core.subscribe,
    dispose: core.dispose,
    actions: {
      async check() {
        // Без клиента сессии (desktop) вход не нужен: полный доступ.
        if (!client) {
          const user: SessionUser = { name: '', role: 'admin' }
          setState({ authRequired: false, currentUser: user })
          emit({ type: 'session.authenticated', user })
          return user
        }
        setState({ authRequired: true, checking: true })
        const user = await client.me().catch(() => null)
        if (core.disposed()) return user
        setState({ checking: false })
        if (user) apply(user)
        else setState({ currentUser: null })
        return user
      },
      async login(name, password) {
        if (!client) return null
        setState({ authError: null })
        const user = await client.login({ name, password }).catch(() => null)
        if (core.disposed()) return user
        if (!user) {
          setState({ authError: 'Неверный логин или пароль' })
          return null
        }
        apply(user)
        return user
      },
      async logout() {
        await client?.logout().catch(() => {})
        core.resetState(initialState(!!client))
        emit({ type: 'session.signedOut' })
      },
      expire() {
        if (!getState().currentUser) return
        core.resetState(initialState(!!client))
        emit({ type: 'session.expired' })
      },
      onEvent(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }
    }
  }
}

