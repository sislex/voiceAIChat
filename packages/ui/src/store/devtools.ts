/** Safe, optional bridge from framework-independent stores to Redux DevTools. */

export const REDACTED = '[REDACTED]'
const SECRET_KEY = /(?:password|passphrase|secret|token|api[_-]?key|authorization|bearer|credential|private[_-]?key)/i
const STREAM_KEY = /(?:stream|console|log|activity|messages|audio|attachment|file|chunks?)/i
const MAX_DEPTH = 8
const MAX_ARRAY = 100
const MAX_STREAM_ARRAY = 50
const MAX_STRING = 2_000
const MAX_STREAM_STRING = 500

export interface ReduxDevToolsConnection {
  init(state: unknown): void
  send(action: string | { type: string }, state: unknown): void
  disconnect?(): void
}

export interface ReduxDevToolsExtension {
  connect(options: { name: string }): ReduxDevToolsConnection
}

export interface DevToolsEnvironment {
  mode: 'development' | 'production' | 'test'
  explicitlyEnabled?: boolean
  extension?: ReduxDevToolsExtension
}

interface DiagnosticStore {
  getState(): Readonly<object>
  subscribe(listener: () => void): () => void
  actions: object
  dispose(): void
}

export function sanitizeDevToolsState(value: unknown): unknown {
  const ancestors = new WeakSet<object>()

  function visit(input: unknown, key: string, depth: number): unknown {
    if (SECRET_KEY.test(key)) return REDACTED
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input
    if (typeof input === 'string') {
      const limit = STREAM_KEY.test(key) ? MAX_STREAM_STRING : MAX_STRING
      return input.length <= limit ? input : `${input.slice(0, limit)}… [truncated ${input.length - limit} chars]`
    }
    if (typeof input === 'bigint') return input.toString()
    if (typeof input === 'undefined') return '[undefined]'
    if (typeof input === 'function' || typeof input === 'symbol') return `[${typeof input}]`
    if (depth >= MAX_DEPTH) return '[max depth]'
    if (input instanceof ArrayBuffer) return `[ArrayBuffer omitted: ${input.byteLength} bytes]`
    if (ArrayBuffer.isView(input)) return `[${input.constructor.name} omitted: ${input.byteLength} bytes]`
    if (input instanceof Date) return input.toISOString()
    if (typeof input !== 'object') return String(input)
    if (ancestors.has(input)) return '[circular]'

    ancestors.add(input)
    try {
      if (Array.isArray(input)) {
        const limit = STREAM_KEY.test(key) ? MAX_STREAM_ARRAY : MAX_ARRAY
        const result: unknown[] = input.slice(0, limit).map((item) => visit(item, key, depth + 1))
        if (input.length > limit) result.push(`[${input.length - limit} more items]`)
        return result
      }
      const result: Record<string, unknown> = {}
      for (const [childKey, child] of Object.entries(input)) result[childKey] = visit(child, childKey, depth + 1)
      return result
    } catch {
      return '[unserializable]'
    } finally {
      ancestors.delete(input)
    }
  }

  return visit(value, '', 0)
}

export interface StoreDiagnostics {
  attach<TStore extends DiagnosticStore>(store: TStore, name: string, domain: string): TStore
}

const NOOP_DIAGNOSTICS: StoreDiagnostics = { attach: (store) => store }

export function createReduxDevToolsDiagnostics(environment: DevToolsEnvironment): StoreDiagnostics {
  if (environment.mode !== 'development' && environment.explicitlyEnabled !== true) return NOOP_DIAGNOSTICS
  const extension = environment.extension
  if (!extension || typeof extension.connect !== 'function') return NOOP_DIAGNOSTICS

  return {
    attach<TStore extends DiagnosticStore>(store: TStore, name: string, domain: string): TStore {
      let connection: ReduxDevToolsConnection
      try {
        connection = extension.connect({ name })
        connection.init(sanitizeDevToolsState(store.getState()))
      } catch {
        return store
      }

      let disposed = false
      const actionStack: string[] = []
      const pending = new Set<string>()
      const unsubscribe = store.subscribe(() => {
        if (disposed) return
        const action = actionStack.at(-1) ?? [...pending].at(-1) ?? `${domain}/update`
        try {
          connection.send(action, sanitizeDevToolsState(store.getState()))
        } catch {
          // Diagnostics must never affect application behavior.
        }
      })
      const actions = new Proxy(store.actions, {
        get(target, property, receiver) {
          const member: unknown = Reflect.get(target, property, receiver)
          if (typeof member !== 'function') return member
          return (...args: unknown[]) => {
            const action = `${domain}/${String(property)}`
            actionStack.push(action)
            try {
              const result: unknown = Reflect.apply(member, target, args)
              if (result instanceof Promise) {
                pending.add(action)
                void result.finally(() => pending.delete(action)).catch(() => undefined)
              }
              return result
            } finally {
              actionStack.pop()
            }
          }
        }
      })

      return new Proxy(store, {
        get(target, property, receiver) {
          if (property === 'actions') return actions
          if (property === 'dispose') {
            return () => {
              if (disposed) return
              disposed = true
              unsubscribe()
              try {
                connection.disconnect?.()
              } catch {
                // External diagnostic failure.
              }
              target.dispose()
            }
          }
          const member: unknown = Reflect.get(target, property, receiver)
          return typeof member === 'function' ? member.bind(target) : member
        }
      }) as TStore
    }
  }
}

export function createBrowserReduxDevToolsDiagnostics(): StoreDiagnostics {
  const env = import.meta.env as Record<string, string | boolean | undefined>
  const extension = typeof window === 'undefined'
    ? undefined
    : (window as typeof window & { __REDUX_DEVTOOLS_EXTENSION__?: ReduxDevToolsExtension }).__REDUX_DEVTOOLS_EXTENSION__
  return createReduxDevToolsDiagnostics({
    mode: env.DEV === true ? 'development' : env.MODE === 'test' ? 'test' : 'production',
    explicitlyEnabled: env.VITE_REDUX_DEVTOOLS === 'true',
    ...(extension ? { extension } : {})
  })
}

