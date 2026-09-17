import { Component, Suspense, createElement, lazy as reactLazy, useState, type ComponentType, type ComponentProps, type ReactNode } from 'react'
import { Button, ErrorState, Skeleton } from '@voicechat/ui-kit'

const RECOVERY_KEY = 'vc.chunk-recovery.v1'
export const CHUNK_REFRESH_EVENT = 'vc:before-chunk-refresh'
function checkRefreshGuard(): void {
  if (!window.dispatchEvent(new Event(CHUNK_REFRESH_EVENT, { cancelable: true }))) throw new Error('Сначала сохраните или отправьте несохранённый ввод и вложения. Обновление отменено.')
}
export async function refreshAfterChunkError(): Promise<void> {
  checkRefreshGuard()
  if (sessionStorage.getItem(RECOVERY_KEY)) throw new Error('Повторное обновление заблокировано. Сохраните работу и откройте приложение заново.')
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    const response = await fetch(location.href.split('#')[0]!, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Приложение пока недоступно. Оболочка и ввод сохранены; попробуйте позже.')
  }
  checkRefreshGuard()
  sessionStorage.setItem(RECOVERY_KEY, '1')
  // Explicit user action only. Existing beforeunload guards remain in effect.
  location.reload()
}

// A failed intent load must not poison activation with a rejected cached promise.
export function sharedLoad<T>(load: () => Promise<T>, timeoutMs = 30000): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    if (!pending) {
      pending = new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Загрузка экрана заняла слишком много времени')), timeoutMs)
        void Promise.resolve().then(load).then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
      })
      void pending.catch(() => { pending = undefined })
    }
    return pending
  }
}
class LocalBoundary extends Component<{ children: ReactNode; retry: () => void; attempts: number; frame: (content: ReactNode) => ReactNode }, { failed: boolean; refreshing: boolean; refreshError: string }> {
  override state = { failed: false, refreshing: false, refreshError: '' }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return this.props.frame(<section aria-label="Ошибка загрузки" style={{ minHeight: 160, minWidth: 0, width: '100%', overflowWrap: 'anywhere' }}>
      <ErrorState message="Не удалось открыть экран" detail={this.props.attempts < 3 ? 'Проверьте соединение и повторите загрузку. Ваш ввод остаётся в оболочке.' : 'Ресурс всё ещё недоступен. Закройте экран и попробуйте позже. Обновление страницы автоматически не выполняется.'} {...(this.props.attempts < 3 ? { onRetry: this.props.retry } : {})} />
      {this.props.attempts >= 3 && <div>
        <p>Если версия приложения изменилась, сохраните изменения в других открытых редакторах перед обновлением. Черновики чата сохраняются отдельно.</p>
        <Button disabled={this.state.refreshing} onClick={() => {
          this.setState({ refreshing: true, refreshError: '' })
          void refreshAfterChunkError().catch(error => this.setState({ refreshing: false, refreshError: error instanceof Error ? error.message : 'Не удалось обновить приложение' }))
        }}>Обновить приложение</Button>
        {this.state.refreshError && <p role="alert">{this.state.refreshError}</p>}
      </div>}
    </section>)
  }
}
// Local retries keep the shell mounted. A stale module cache needs an explicit guarded refresh.
export function lazyScreen<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>, options: { loading?: ReactNode; frame?: (content: ReactNode, props: ComponentProps<T>) => ReactNode } = {}): ComponentType<ComponentProps<T>> & { preload(): Promise<void> } {
  const load = sharedLoad(loader)
  const Screen = (props: ComponentProps<T>): JSX.Element => {
    const [Current, setCurrent] = useState(() => reactLazy(load))
    const [attempts, setAttempts] = useState(0)
    const frame = (content: ReactNode): ReactNode => options.frame ? options.frame(content, props) : content
    return <LocalBoundary frame={frame} key={attempts} attempts={attempts} retry={() => { setCurrent(() => reactLazy(load)); setAttempts(value => value + 1) }}>
      <Suspense fallback={frame(options.loading ?? <section role="status" aria-label="Загрузка экрана" aria-busy="true" style={{ minHeight: 160, minWidth: 0, width: '100%' }}><Skeleton height={160} /></section>)}>
        {createElement(Current as ComponentType<ComponentProps<T>>, props)}
      </Suspense>
    </LocalBoundary>
  }
  Screen.preload = async (): Promise<void> => { try { await load() } catch { /* Activation offers an explicit local retry. */ } }
  return Screen
}
