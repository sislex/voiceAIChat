// React-биндинг доменных хранилищ (CHAT-236).
//
// Универсального хука, который снова собрал бы все домены в один объект, здесь
// нет и быть не должно: компонент подписывается на конкретный домен и на
// узкий срез внутри него, поэтому обновление аудио или админских данных не
// перерисовывает страницу чата.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import type { Store } from './createStore'
import type { AppRuntime, AppRuntimeDeps, RealtimeConnect } from '../runtime/appRuntime'
import { createAppRuntime } from '../runtime/appRuntime'
import { createBrowserClients, createBrowserRealtime, type BrowserClientOverrides } from '../clients'
import type { PipelineDelays } from './mockPipeline'

const RuntimeContext = createContext<AppRuntime | null>(null)

export function AppRuntimeProvider({ runtime, children }: { runtime: AppRuntime; children: ReactNode }): JSX.Element {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
}

export function useAppRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('AppRuntimeProvider не смонтирован')
  return runtime
}

/**
 * Подписка на узкий срез хранилища. Значение стабильно по `Object.is`: если
 * срез не изменился, компонент не перерисовывается, даже когда домен обновил
 * соседние поля.
 */
export function useStoreSelector<S, A, T>(store: Store<S, A>, selector: (state: Readonly<S>) => T): T {
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const cache = useRef<{ state: Readonly<S>; value: T } | null>(null)
  const getSnapshot = useCallback((): T => {
    const state = store.getState()
    const previous = cache.current
    if (previous && previous.state === state) return previous.value
    const next = selectorRef.current(state)
    if (previous && Object.is(previous.value, next)) {
      cache.current = { state, value: previous.value }
      return previous.value
    }
    cache.current = { state, value: next }
    return next
  }, [store])
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

export function useShell<T>(selector: (state: ReturnType<AppRuntime['shell']['getState']>) => T): T {
  return useStoreSelector(useAppRuntime().shell, selector)
}

export function useSession<T>(selector: (state: ReturnType<AppRuntime['session']['getState']>) => T): T {
  return useStoreSelector(useAppRuntime().session, selector)
}

export function useSettings<T>(selector: (state: ReturnType<AppRuntime['settings']['getState']>) => T): T {
  return useStoreSelector(useAppRuntime().settings, selector)
}

export function useChat<T>(selector: (state: ReturnType<AppRuntime['chat']['getState']>) => T): T {
  return useStoreSelector(useAppRuntime().chat, selector)
}

export function useVoice<T>(selector: (state: ReturnType<AppRuntime['voice']['getState']>) => T): T {
  return useStoreSelector(useAppRuntime().voice, selector)
}

export function useOperations<T>(selector: (state: ReturnType<AppRuntime['operations']['getState']>) => T): T {
  return useStoreSelector(useAppRuntime().operations, selector)
}

export function useAdmin<T>(selector: (state: ReturnType<AppRuntime['admin']['getState']>) => T): T {
  return useStoreSelector(useAppRuntime().admin, selector)
}

export function useProjects<T>(selector: (state: ReturnType<AppRuntime['projects']['getState']>) => T): T {
  return useStoreSelector(useAppRuntime().projects, selector)
}

/** Действия домена стабильны по ссылке — их можно класть в зависимости эффектов. */
export const useShellActions = (): AppRuntime['shell']['actions'] => useAppRuntime().shell.actions
export const useSessionActions = (): AppRuntime['session']['actions'] => useAppRuntime().session.actions
export const useSettingsActions = (): AppRuntime['settings']['actions'] => useAppRuntime().settings.actions
export const useChatActions = (): AppRuntime['chat']['actions'] => useAppRuntime().chat.actions
export const useVoiceActions = (): AppRuntime['voice']['actions'] => useAppRuntime().voice.actions
export const useOperationsActions = (): AppRuntime['operations']['actions'] => useAppRuntime().operations.actions
export const useAdminActions = (): AppRuntime['admin']['actions'] => useAppRuntime().admin.actions
export const useProjectsActions = (): AppRuntime['projects']['actions'] => useAppRuntime().projects.actions

export interface CreateRuntimeOptions extends BrowserClientOverrides {
  /** Чат из адреса (#/chat/:id) на момент монтирования — открыть его первым. */
  initialChatId?: string | null
  now?: () => number
  delays?: Partial<PipelineDelays>
  realtime?: RealtimeConnect
}

/**
 * Создаёт runtime один раз на монтирование, запускает bootstrap и освобождает
 * ресурсы приложения при размонтировании.
 */
export function useCreateAppRuntime(options: CreateRuntimeOptions = {}): AppRuntime {
  const initialChatId = useRef(options.initialChatId ?? null)
  const runtime = useMemo(() => {
    const { initialChatId: _ignored, now, delays, realtime, ...overrides } = options
    const runtimeDeps: AppRuntimeDeps = {
      clients: createBrowserClients(overrides),
      realtime: realtime ?? createBrowserRealtime(),
      ...(now ? { now } : {}),
      ...(delays ? { delays } : {})
    }
    return createAppRuntime(runtimeDeps)
    // Runtime создаётся один раз: пересборка порвала бы подписки и состояние.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void runtime.start(initialChatId.current)
    return () => runtime.dispose()
  }, [runtime])

  return runtime
}

