// Список устройств — переиспользуемая поверхность модуля. Её показывают и в
// диалоге аккаунта, и в админской карточке пользователя: два разных списка
// расходились бы в мелочах и сеяли сомнение, какой из них правдивый.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button, EmptyState, ErrorState } from '@voicechat/ui-kit'
import { DeviceCard } from './DeviceCard'
import { DEFAULT_TEXTS, type SessionsTexts } from './texts'
import type { SessionsStore } from './store/sessionsStore'

/** Подтверждение опасного действия. Не дали — действие выполняется сразу. */
export type SessionsConfirm = (request: { title: string; text?: string; variant?: 'danger' }) => Promise<boolean>

export interface SessionsPanelProps {
  store: SessionsStore
  texts?: Partial<SessionsTexts>
  locale?: string
  /** Чужой список (админка): без переименования, доверия и массовых кнопок. */
  readOnly?: boolean
  /** Порог, с которого появляется поиск: в списке из двух устройств он лишний. */
  searchFrom?: number
  confirm?: SessionsConfirm
  /** Момент отсчёта: тесты и Storybook замораживают время. */
  now?: number
}

export function SessionsPanel({ store, texts: overrides, locale = 'ru-RU', readOnly = false, searchFrom = 4, confirm, now }: SessionsPanelProps): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const texts = useMemo(() => ({ ...DEFAULT_TEXTS, ...overrides }), [overrides])
  // Часы фиксируем на монтирование: иначе «5 минут назад» меняется на каждый
  // рендер и тесты со снимками текста становятся флаки.
  const [mountedAt] = useState(() => now ?? Date.now())
  useEffect(() => {
    void store.actions.load()
  }, [store])

  const views = store.visible()
  const ask = async (request: { title: string; text?: string }): Promise<boolean> => (confirm ? confirm({ ...request, variant: 'danger' }) : true)

  if (state.status === 'loading' || state.status === 'idle') return <p className="vcs-note">{texts.loading}</p>
  if (state.status === 'error') {
    return <ErrorState message={texts.errorMessage} detail={state.error} onRetry={() => void store.actions.reload()} retryLabel={texts.retry} />
  }
  if (state.sessions.length === 0) return <EmptyState title={texts.emptyTitle} description={texts.emptyDescription} icon="📱" />

  return (
    <div className="vcs" data-testid="sessions-panel">
      {state.sessions.length >= searchFrom && (
        <label className="vcs-search">
          <span className="vcs-search-label">{texts.searchLabel}</span>
          <input
            className="vcs-input"
            type="search"
            value={state.query}
            placeholder={texts.searchPlaceholder}
            onChange={(e) => store.actions.setQuery(e.target.value)}
          />
        </label>
      )}
      {views.length === 0 ? (
        <EmptyState compact title={texts.searchEmpty} icon="🔍" />
      ) : (
        <ul className="vcs-list" role="list">
          {views.map((view) => (
            <DeviceCard
              key={view.session.sid}
              view={view}
              texts={texts}
              locale={locale}
              now={mountedAt}
              busy={state.busySid === view.session.sid || state.busyAll}
              canRename={!readOnly && store.capabilities.rename}
              canTrust={!readOnly && store.capabilities.trust}
              onRevoke={() => {
                void ask({ title: texts.revokeConfirmTitle(view.title), text: texts.revokeConfirmText })
                  .then((ok) => (ok ? store.actions.revoke(view.session.sid) : false))
              }}
              onRename={(label) => void store.actions.rename(view.session.sid, label)}
              onTrust={(trusted) => void store.actions.setTrusted(view.session.sid, trusted)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Массовые действия: живут в подвале диалога, поэтому вынесены из панели. */
export function SessionsBulkActions({ store, texts: overrides, confirm }: { store: SessionsStore; texts?: Partial<SessionsTexts>; confirm?: SessionsConfirm }): JSX.Element | null {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const texts = useMemo(() => ({ ...DEFAULT_TEXTS, ...overrides }), [overrides])
  const others = store.otherCount()
  const showOthers = store.capabilities.revokeOthers && others > 0
  const showAll = store.capabilities.revokeAll && state.sessions.length > 0
  if (!showOthers && !showAll) return null
  const ask = async (request: { title: string; text?: string }): Promise<boolean> => (confirm ? confirm({ ...request, variant: 'danger' }) : true)
  return (
    <div className="vcs-bulk">
      {showOthers && (
        <Button size="sm" variant="danger" loading={state.busyAll} onClick={() => void store.actions.revokeOthers()}>
          {texts.revokeOthers(others)}
        </Button>
      )}
      {showAll && (
        <Button
          size="sm"
          variant="ghost"
          disabled={state.busyAll}
          onClick={() => {
            void ask({ title: texts.revokeAllConfirmTitle, text: texts.revokeAllConfirmText })
              .then((ok) => (ok ? store.actions.revokeAll() : false))
          }}
        >
          {texts.revokeAll}
        </Button>
      )}
    </div>
  )
}
