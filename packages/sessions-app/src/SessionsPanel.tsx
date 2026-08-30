// Список устройств — переиспользуемая поверхность модуля. Её показывают и в
// диалоге аккаунта, и в админской карточке пользователя: два разных списка
// расходились бы в мелочах и сеяли сомнение, какой из них правдивый.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button, EmptyState, ErrorState } from '@voicechat/ui-kit'
import { DeviceCard } from './DeviceCard'
import { formatMoment } from './format'
import { EndedSessions } from './EndedSessions'
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
  /** Сколько карточек рисовать за раз: аккаунты агентов набирают десятки сессий. */
  maxVisible?: number
  confirm?: SessionsConfirm
  /** Момент отсчёта: тесты и Storybook замораживают время. */
  now?: number
}

export function SessionsPanel({ store, texts: overrides, locale = 'ru-RU', readOnly = false, searchFrom = 4, maxVisible = 20, confirm, now }: SessionsPanelProps): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const texts = useMemo(() => ({ ...DEFAULT_TEXTS, ...overrides }), [overrides])
  // Время идёт: «активность 5 минут назад» обязана стареть, пока окно открыто,
  // иначе через полчаса список уверенно врёт. Тик редкий (полминуты) — этого
  // хватает подписям и не заставляет перерисовывать список постоянно. Проп
  // `now` замораживает часы для тестов и витрины.
  const [tick, setTick] = useState(() => now ?? Date.now())
  useEffect(() => {
    if (now !== undefined) return
    const timer = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [now])
  const currentNow = now ?? tick
  useEffect(() => {
    void store.actions.load()
  }, [store])
  // Возврат к экрану — момент, когда список читают. Сигнал даёт хост
  // (SessionsHost.onVisible): сам модуль про document и window не знает.
  useEffect(() => store.onVisible?.(() => void store.actions.reload()), [store])

  const selected = state.selected
  const allViews = store.visible()
  const views = allViews.slice(0, maxVisible)
  const hidden = allViews.length - views.length
  const platforms = store.platforms()
  const ask = async (request: { title: string; text?: string }): Promise<boolean> => (confirm ? confirm({ ...request, variant: 'danger' }) : true)

  if (state.status === 'loading' || state.status === 'idle') return <p className="vcs-note">{texts.loading}</p>
  if (state.status === 'error') {
    return <ErrorState message={texts.errorMessage} detail={state.error} onRetry={() => void store.actions.reload()} retryLabel={texts.retry} />
  }
  if (state.sessions.length === 0) return <EmptyState title={texts.emptyTitle} description={texts.emptyDescription} icon="📱" />

  return (
    <div className="vcs" data-testid="sessions-panel">
      {/* Результат действия — для скринридера: он не видит, что карточка исчезла. */}
      <p className="vcs-live" role="status" aria-live="polite">{state.announcement ?? ''}</p>
      <div className="vcs-toolbar">
        <label className="vcs-order">
          <span className="vcs-search-label">{texts.orderLabel}</span>
          <select className="vcs-input" value={state.order} onChange={(e) => store.actions.setOrder(e.target.value as typeof state.order)}>
            <option value="activity">{texts.orderActivity}</option>
            <option value="created">{texts.orderCreated}</option>
            <option value="title">{texts.orderTitle}</option>
          </select>
        </label>
        <Button size="sm" variant="ghost" onClick={() => void store.actions.reload()}>{texts.refresh}</Button>
        {state.loadedAt !== null && <span className="vcs-note">{texts.refreshedAt(formatMoment(state.loadedAt, locale))}</span>}
      </div>
      {selected.length > 0 && (
        <div className="vcs-bulk vcs-bulk--selection">
          <span>{texts.selectedCount(selected.length)}</span>
          <Button
            size="sm"
            variant="danger"
            loading={state.busyAll}
            onClick={() => {
              void ask({ title: texts.revokeSelected(selected.length), text: texts.revokeConfirmText })
                .then((ok) => (ok ? store.actions.revokeSelected() : false))
            }}
          >
            {texts.revokeSelected(selected.length)}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => store.actions.clearSelected()}>{texts.clearSelection}</Button>
        </div>
      )}
      {platforms.length > 1 && (
        <div className="vcs-chips" role="group" aria-label="Фильтр по платформе">
          <Button size="sm" variant={state.platform === null ? 'primary' : 'ghost'} onClick={() => store.actions.setPlatform(null)}>{texts.platformAll}</Button>
          {platforms.map((platform) => (
            <Button
              key={platform}
              size="sm"
              variant={state.platform === platform ? 'primary' : 'ghost'}
              onClick={() => store.actions.setPlatform(state.platform === platform ? null : platform)}
            >
              {texts.platformLabel(platform)}
            </Button>
          ))}
        </div>
      )}
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
              now={currentNow}
              busy={state.busySid === view.session.sid || state.busyAll}
              canRename={!readOnly && store.capabilities.rename}
              canTrust={!readOnly && store.capabilities.trust}
              onRevoke={() => {
                void ask({ title: texts.revokeConfirmTitle(view.title), text: texts.revokeConfirmText })
                  .then((ok) => (ok ? store.actions.revoke(view.session.sid) : false))
              }}
              onRename={(label) => void store.actions.rename(view.session.sid, label)}
              onTrust={(trusted) => void store.actions.setTrusted(view.session.sid, trusted)}
              {...(readOnly ? {} : { selected: selected.includes(view.session.sid), onToggleSelected: () => store.actions.toggleSelected(view.session.sid) })}
              {...(store.capabilities.history ? { history: state.history[view.session.sid], onHistory: () => void store.actions.loadHistory(view.session.sid) } : {})}
              {...(!readOnly && view.session.deviceKey
                ? {
                    onRevokeDevice: () => {
                      void ask({ title: texts.revokeDeviceConfirmTitle(view.title), text: texts.revokeDeviceConfirmText })
                        .then((ok) => (ok ? store.actions.revokeDevice(view.session.deviceKey!) : false))
                    }
                  }
                : {})}
            />
          ))}
        </ul>
      )}
      {hidden > 0 && <p className="vcs-note">{texts.moreHidden(hidden)}</p>}
      {!readOnly && store.capabilities.ended && (
        <EndedSessions sessions={state.ended} texts={texts} locale={locale} onOpen={() => void store.actions.loadEnded()} />
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
  if (!showOthers && !showAll && !store.capabilities.panic && !store.capabilities.copy) return null
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
      {store.capabilities.copy && (
        <Button size="sm" variant="ghost" disabled={state.busyAll} onClick={() => void store.actions.copySummary()}>
          {texts.copySummary}
        </Button>
      )}
      {store.capabilities.panic && (
        <Button
          size="sm"
          variant="danger"
          disabled={state.busyAll}
          onClick={() => {
            void ask({ title: texts.panicConfirmTitle, text: texts.panicConfirmText })
              .then((ok) => (ok ? store.actions.panic() : false))
          }}
        >
          {texts.panic}
        </Button>
      )}
    </div>
  )
}
