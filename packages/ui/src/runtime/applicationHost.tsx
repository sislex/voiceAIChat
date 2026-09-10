import * as react from 'react'
import * as reactDom from 'react-dom'
import * as jsx from 'react/jsx-runtime'
import * as uiKit from '@voicechat/ui-kit'
import * as runtime from '@voicechat/ui-foundation/runtime'
import {
  APPLICATION_HOST_API_VERSION,
  parseApplicationFrontendManifest
} from '@shared/applicationFrontend'

type Panel = react.ComponentType<never>
interface Registration {
  version: string
  commit: string | null
  components: Record<string, Panel>
  integrity?: string
}
const panels = new Map<string, Registration>(),
  loading = new Map<string, Promise<Registration>>()
let serverBase = ''
/** Публичный, версионированный порт: контексты React и UI-kit едины во всех приложениях. */
export function configureApplicationHost(base: string): void {
  serverBase = base.replace(/\/$/, '')
  Object.assign(window, {
    VoiceChatApplicationHost: {
      apiVersion: APPLICATION_HOST_API_VERSION,
      react,
      reactDom,
      jsx,
      uiKit,
      runtime,
      register(
        id: string,
        version: string,
        commit: string | null,
        component: Panel | Record<string, Panel>
      ) {
        panels.set(id, {
          version,
          commit,
          components:
            typeof component === 'function'
              ? { default: component }
              : (component as Record<string, Panel>)
        })
      }
    }
  })
}
export async function loadApplicationPanel<P>(
  id: string,
  component = 'default'
): Promise<{ default: react.ComponentType<P> }> {
  if (!/^[a-z][a-z0-9-]+$/.test(id)) throw new Error('Неверное приложение')
  if (!('VoiceChatApplicationHost' in window))
    configureApplicationHost(serverBase)
  const key = serverBase + '/' + id
  let promise = loading.get(key)
  if (!promise) {
    promise = (async () => {
      const base = `${serverBase}/applications/${id}/`
      const response = await fetch(base + 'manifest.json', {
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(15_000)
      })
      if (!response.ok)
        throw new Error(`Приложение недоступно (${response.status})`)
      const manifest = parseApplicationFrontendManifest(
        await response.json(),
        id
      )
      const loaded = panels.get(id)
      if (
        loaded?.version === manifest.version &&
        loaded.commit === manifest.commit &&
        loaded.integrity === manifest.entry.integrity
      )
        return loaded
      const resources: HTMLElement[] = []
      try {
        await Promise.all(
          manifest.styles.map(
            (asset) =>
              new Promise<void>((resolve, reject) => {
                const link = document.createElement('link')
                resources.push(link)
                link.rel = 'stylesheet'
                link.href = base + asset.path
                link.integrity = asset.integrity
                link.crossOrigin = 'anonymous'
                const timer = setTimeout(
                  () =>
                    reject(new Error('Не удалось загрузить стили приложения')),
                  20_000
                )
                link.onload = () => {
                  clearTimeout(timer)
                  resolve()
                }
                link.onerror = () => {
                  clearTimeout(timer)
                  reject(new Error('Не удалось проверить стили приложения'))
                }
                document.head.append(link)
              })
          )
        )
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          resources.push(script)
          script.src = base + manifest.entry.path
          script.integrity = manifest.entry.integrity
          script.crossOrigin = 'anonymous'
          const timer = setTimeout(
            () => reject(new Error('Не удалось загрузить приложение')),
            20_000
          )
          script.onload = () => {
            clearTimeout(timer)
            resolve()
          }
          script.onerror = () => {
            clearTimeout(timer)
            reject(new Error('Не удалось проверить приложение'))
          }
          document.head.append(script)
        })
        const panel = panels.get(id)
        if (
          !panel ||
          panel.version !== manifest.version ||
          panel.commit !== manifest.commit
        )
          throw new Error('Загружена другая версия приложения')
        panel.integrity = manifest.entry.integrity
        return panel
      } catch (error) {
        resources.forEach((element) => element.remove())
        throw error
      }
    })()
    loading.set(key, promise)
    void promise.catch(() => loading.delete(key))
  }
  const registration = await promise
  if (
    !Object.hasOwn(registration.components, component) ||
    typeof registration.components[component] !== 'function'
  )
    throw new Error('В артефакте отсутствует запрошенная поверхность')
  return {
    default: registration.components[component] as react.ComponentType<P>
  }
}

/** Ошибка render/effect тоже ограничена панелью и не уничтожает черновик чата. */
class ApplicationBoundary extends react.Component<
  { children: react.ReactNode; retry(): void },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override render(): react.ReactNode {
    return this.state.failed ? (
      <div role="alert">
        <p>Ошибка приложения</p>
        <uiKit.Button onClick={this.props.retry}>
          Перезапустить приложение
        </uiKit.Button>
      </div>
    ) : (
      this.props.children
    )
  }
}

/** Ошибка одного артефакта оставляет чат доступным и допускает повтор загрузки. */
export function createApplicationPanel<P extends object>(
  id: string,
  component = 'default'
): react.ComponentType<P> {
  return function ApplicationPanel(props: P): JSX.Element {
    const [state, setState] = react.useState<{
      component?: react.ComponentType<P>
      error?: string
    }>({})
    const [attempt, retry] = react.useReducer((value) => value + 1, 0)
    react.useEffect(() => {
      let alive = true
      setState({})
      void loadApplicationPanel<P>(id, component).then(
        (module) => {
          if (alive) setState({ component: module.default })
        },
        (error) => {
          if (alive)
            setState({
              error:
                error instanceof Error
                  ? error.message
                  : 'Не удалось загрузить приложение'
            })
        }
      )
      return () => {
        alive = false
      }
    }, [attempt])
    return state.component ? (
      <ApplicationBoundary key={attempt} retry={() => retry()}>
        {react.createElement(state.component, props)}
      </ApplicationBoundary>
    ) : state.error ? (
      <div role="alert">
        <p>{state.error}</p>
        <uiKit.Button onClick={() => retry()}>Повторить загрузку</uiKit.Button>
      </div>
    ) : (
      <div role="status">Загрузка приложения…</div>
    )
  }
}
