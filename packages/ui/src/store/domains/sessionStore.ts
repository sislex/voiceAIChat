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
  /** Ожидается код второго фактора (auth-roadmap п.6): тикет от сервера после верного пароля. */
  twoFactorTicket: string | null
  /** Идёт ли проверка сохранённой сессии (`/me`). В web стартует как true: до
   *  ответа `/me` нельзя показывать форму логина — она мигнёт у уже вошедшего. */
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
  /** Второй шаг входа: код TOTP по тикету. */
  loginCode(code: string): Promise<SessionUser | null>
  /** Отменить второй шаг и вернуться к паролю. */
  cancelTwoFactor(): void
  /** Сброс пароля кодом администратора (auth-roadmap п.10) → сессия. */
  resetPassword(name: string, code: string, password: string): Promise<SessionUser | null>
  /** Обновить пользователя после смены временного пароля (п.11). */
  refreshUser(): Promise<void>
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
  return { authRequired, currentUser: null, authError: null, checking: authRequired, twoFactorTicket: null }
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
          setState({ authRequired: false, checking: false, currentUser: user })
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
        const result = await client.login({ name, password }).catch(() => null)
        if (core.disposed()) return null
        if (result && 'requires2fa' in result) {
          setState({ twoFactorTicket: result.ticket, authError: null })
          return null
        }
        const user = result
        if (!user) {
          setState({ authError: 'Неверный логин или пароль' })
          return null
        }
        apply(user)
        return user
      },
      async loginCode(code) {
        const ticket = getState().twoFactorTicket
        if (!client?.login2fa || !ticket) return null
        setState({ authError: null })
        const user = await client.login2fa({ ticket, code }).catch(() => null)
        if (core.disposed()) return null
        if (!user) { setState({ authError: 'Неверный код подтверждения' }); return null }
        setState({ twoFactorTicket: null })
        apply(user)
        return user
      },
      cancelTwoFactor() { setState({ twoFactorTicket: null, authError: null }) },
      async resetPassword(name, code, password) {
        if (!client?.resetPassword) return null
        setState({ authError: null })
        const r = await client.resetPassword({ name, code, password }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
        if (core.disposed()) return null
        if ('error' in r) { setState({ authError: r.error }); return null }
        const user = await client.me().catch(() => null)
        if (!user) { setState({ authError: 'Пароль изменён, но войти не удалось — попробуйте ещё раз' }); return null }
        apply(user)
        return user
      },
      async refreshUser() {
        const user = await client?.me().catch(() => null)
        if (user && !core.disposed()) setState({ currentUser: user })
      },
      async logout() {
        await client?.logout()
        if (core.disposed()) return
        core.resetState({ ...initialState(!!client), checking: false })
        emit({ type: 'session.signedOut' })
      },
      expire() {
        if (!getState().currentUser) return
        core.resetState({ ...initialState(!!client), checking: false })
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

