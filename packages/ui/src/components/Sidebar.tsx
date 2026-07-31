import { useEffect, useRef, useState } from 'react'
import {
  activeStatusLabel,
  CONVERSATION_STATUSES,
  DEFAULT_CONVERSATION_STATUS,
  type Conversation,
  type ConversationStatus,
  type MessageRole,
  type MessageSearchHit,
  type SessionUser
} from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'
import type { ProjectSummary } from '@shared/projects'
import { ACCENT } from '../lib/view'
import { splitSnippet } from '../lib/snippet'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Skeleton, RefreshIndicator } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import { ErrorState } from './ui/ErrorState'
import { loadView, type LoadStatus } from '../lib/loadState'
import { GearIcon } from './icons'
import { formatCombo } from '../lib/hotkeys'

/** Человекочитаемая мета разговора: «Сегодня · 6 сообщений». */
function formatMeta(c: Conversation, now: number): string {
  const d = new Date(c.updatedAt)
  const today = new Date(now)
  const yesterday = new Date(now - 86_400_000)
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  let day: string
  if (sameDay(d, today)) day = 'Сегодня'
  else if (sameDay(d, yesterday)) day = 'Вчера'
  else day = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

  const n = c.messageCount
  const word = pluralMessages(n)
  return `${day} · ${n} ${word}`
}

function pluralMessages(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'сообщение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сообщения'
  return 'сообщений'
}

/** Что показывает панель результатов поиска по сообщениям (данные из стора). */
export interface MessageSearchView {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  hits: MessageSearchHit[]
  nextCursor: string | null
  loadingMore: boolean
  error: string | null
}

const EMPTY_SEARCH_VIEW: MessageSearchView = {
  query: '',
  status: 'idle',
  hits: [],
  nextCursor: null,
  loadingMore: false,
  error: null
}

/** Автор найденного сообщения: у пользователя может быть несколько спикеров. */
function roleLabel(role: MessageRole): string {
  if (role === 'ai') return 'Модель'
  return role === 'u1' ? 'Вы' : `Спикер ${role.slice(1)}`
}

/** «Сегодня, 14:05» — дата беседы плюс готовое локальное время сообщения. */
function formatHitDate(hit: MessageSearchHit, now: number): string {
  const d = new Date(hit.createdAt)
  const today = new Date(now)
  const yesterday = new Date(now - 86_400_000)
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const day = sameDay(d, today)
    ? 'Сегодня'
    : sameDay(d, yesterday)
      ? 'Вчера'
      : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  return hit.time ? `${day}, ${hit.time}` : day
}

interface MessageResultsProps {
  search: MessageSearchView
  now: number
  onPick: (hit: MessageSearchHit) => void
  onRetry?: () => void
  onLoadMore?: () => void
}

/**
 * Результаты поиска по сообщениям. Четыре состояния: пусто (подсказка про
 * синтаксис), загрузка (скелетоны), ошибка (с «Повторить») и найденное.
 */
function MessageResults({ search, now, onPick, onRetry, onLoadMore }: MessageResultsProps): JSX.Element {
  const { status, hits, error } = search
  if (status === 'error') {
    return (
      <div className="convolist msgfound-list">
        <ErrorState message="Поиск не удался" detail={error} {...(onRetry ? { onRetry } : {})} />
      </div>
    )
  }
  if (status === 'loading' && hits.length === 0) {
    return (
      <div className="convolist msgfound-list" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="card" testId="msgfound-skeleton" height={92} lines={3} />
        ))}
      </div>
    )
  }
  if (status === 'idle' || search.query === '') {
    return (
      <div className="convolist msgfound-list">
        <p className="convo-empty msgfound-hint">
          Ищем по тексту всех ваших сообщений. Несколько слов — все должны встретиться в сообщении;
          последнее слово ищется по началу («мигра» найдёт «миграцию»). Регистр не важен.
        </p>
      </div>
    )
  }
  if (hits.length === 0) {
    return (
      <div className="convolist msgfound-list">
        <EmptyState
          compact
          icon="🔍"
          title="Ничего не найдено"
          description="Уберите последнее слово или поищите по названиям беседы."
        />
      </div>
    )
  }
  return (
    <div className="convolist msgfound-list">
      {hits.map((hit) => (
        <button key={hit.messageId} className="msgfound" onClick={() => onPick(hit)}>
          <span className="msgfound-head">
            <span className="msgfound-title">{hit.conversationTitle}</span>
            <span className="msgfound-date">{formatHitDate(hit, now)}</span>
          </span>
          <span className="msgfound-snippet">
            {splitSnippet(hit.snippet).map((part, i) =>
              part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>
            )}
          </span>
          <span className="msgfound-role">{roleLabel(hit.role)}</span>
        </button>
      ))}
      {search.nextCursor && onLoadMore && (
        <button className="msgfound-more" onClick={onLoadMore} disabled={search.loadingMore}>
          {search.loadingMore ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}
    </div>
  )
}

export type SidebarMode = 'chats' | 'projects'

/** Область поиска в сайдбаре: названия бесед или текст сообщений. */
export type SearchScope = 'chats' | 'messages'

export interface SidebarProps {
  conversations: Conversation[]
  /** Состояние загрузки списка: скелетон на первой загрузке, ошибка — с «Повторить». */
  conversationsStatus?: LoadStatus
  /** Техническая деталь ошибки загрузки списка (под «Подробнее»). */
  conversationsError?: string | null
  /** Повторить загрузку списка бесед. */
  onRetryConversations?: () => void
  activeId: string | null
  /** id разговоров, где сейчас идёт ход модели (индикатор «идёт работа»). */
  workingIds?: string[]
  now: number
  onNew: () => void
  onPick: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  /** Сменить persistent-статус жизненного цикла чата. */
  onStatusChange?: (id: string, status: ConversationStatus) => void
  /** Живой список нужен только для имени машины последнего сообщения. */
  agents?: AgentInfo[]
  searchQuery: string
  onSearch: (query: string) => void
  /** Область поиска; не задан `onSearchScopeChange` — переключатель скрыт. */
  searchScope?: SearchScope
  onSearchScopeChange?: (scope: SearchScope) => void
  /** Результаты поиска по сообщениям (режим «Сообщения»). */
  messageSearch?: MessageSearchView
  /** Открыть найденное сообщение: беседа + прокрутка к нему. */
  onPickMessage?: (hit: MessageSearchHit) => void
  /** Повторить упавший поиск. */
  onRetryMessageSearch?: () => void
  /** Догрузить следующую страницу результатов. */
  onLoadMoreMessages?: () => void
  /** Проекты пользователя для селекта над поиском. */
  projects?: ProjectSummary[]
  /** Выбранный в сайдбаре проект (null — «Без проекта»). */
  selectedProjectId?: string | null
  /** Сменить выбранный проект (фильтрует список/поиск, влияет на «Новый»). */
  onSelectProject?: (id: string | null) => void
  onOpenObserver: () => void
  onOpenKnowledgeBase?: () => void
  onOpenSettings: () => void
  /** Открыть файловый проводник по машине-агенту (web). */
  onOpenFiles?: () => void
  /** Открыть консоль по машине-агенту (web). */
  onOpenConsole?: () => void
  /** Открыть админ-страницу пользователей (только admin). */
  onOpenUsers?: () => void
  /** Открыть меню «Машины» (статус агентских машин; web). */
  onOpenMachines?: () => void
  /** Открыть страницу «Команды» (CI-раннер; web). */
  onOpenCi?: () => void
  /** Текущий пользователь (web-режим); null/без имени — строка входа не показывается. */
  currentUser?: SessionUser | null
  /** Выйти из сессии (web). */
  onLogout?: () => void
  /** Режим списка: чаты или проекты. По умолчанию 'chats'. */
  mode?: SidebarMode
  /** Сегмент «Чаты | Проекты»; не задан — переключатель скрыт (desktop/local). */
  onModeChange?: (mode: SidebarMode) => void
  /** Активный проект (открыта его доска) — подсветка в списке проектов. */
  activeProjectId?: string | null
  /** Открыть доску проекта из списка. */
  onPickProject?: (id: string) => void
  /** Создать проект из инлайн-формы списка (имя уже обрезано и не пустое). */
  onCreateProject?: (name: string) => void
  /** Открыть командную палитру (кнопка «⌘K» рядом с поиском); не задан — кнопки нет. */
  onOpenCommandPalette?: () => void
  /** Мобильный режим: сайдбар выдвинут поверх контента. */
  open?: boolean
  /** Свернуть сайдбар на десктопе (шеврон в шапке); undefined — кнопку не показываем. */
  onToggleCollapse?: () => void
}

export function Sidebar({
  conversations,
  conversationsStatus = 'ready',
  conversationsError = null,
  onRetryConversations,
  activeId,
  workingIds = [],
  now,
  onNew,
  onPick,
  onDelete,
  onRename,
  onStatusChange,
  agents = [],
  searchQuery,
  onSearch,
  searchScope = 'chats',
  onSearchScopeChange,
  messageSearch = EMPTY_SEARCH_VIEW,
  onPickMessage,
  onRetryMessageSearch,
  onLoadMoreMessages,
  projects = [],
  selectedProjectId = null,
  onSelectProject,
  onOpenObserver,
  onOpenKnowledgeBase,
  onOpenSettings,
  onOpenFiles,
  onOpenConsole,
  onOpenUsers,
  onOpenMachines,
  onOpenCi,
  currentUser,
  onLogout,
  mode = 'chats',
  onModeChange,
  activeProjectId = null,
  onPickProject,
  onCreateProject,
  onOpenCommandPalette,
  open = false,
  onToggleCollapse
}: SidebarProps): JSX.Element {
  // id разговора, для которого показываем инлайн-подтверждение удаления.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // id разговора в режиме переименования + черновик названия.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // Открыто ли меню аккаунта (Машины/Пользователи/Настройки/Выйти).
  const [acctOpen, setAcctOpen] = useState(false)
  // Инлайн-форма создания проекта в списке проектов.
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectDraft, setProjectDraft] = useState('')
  const acctRef = useRef<HTMLDivElement | null>(null)
  const workingSet = new Set(workingIds)
  // Поиск по сообщениям заменяет список бесед: у панели свои состояния и карточки.
  const inMessages = searchScope === 'messages'
  // Состояния списка бесед по общему правилу: скелетон — только пока данных нет,
  // при повторной загрузке список остаётся на месте (см. lib/loadState.ts).
  const chats = loadView(conversationsStatus, conversations.length > 0)

  // Меню аккаунта закрывается по клику вне и по Esc.
  useEffect(() => {
    if (!acctOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (acctRef.current && !acctRef.current.contains(e.target as Node)) setAcctOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAcctOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [acctOpen])

  const startRename = (c: Conversation): void => {
    setRenamingId(c.id)
    setRenameDraft(c.title)
  }
  const commitRename = (): void => {
    if (renamingId && renameDraft.trim()) onRename(renamingId, renameDraft)
    setRenamingId(null)
    setRenameDraft('')
  }
  const cancelRename = (): void => {
    setRenamingId(null)
    setRenameDraft('')
  }

  // Пункт меню аккаунта: закрыть меню и выполнить действие.
  const acct = (fn: () => void) => (): void => {
    setAcctOpen(false)
    fn()
  }

  return (
    <aside className={open ? 'side side--open' : 'side'}>
      <div className="sidehead">
        <span className="logo">
          <span className="logodot" style={{ background: ACCENT }} />
          Голос·Чат
        </span>
        <div className="sidehead-actions">
          <Button size="sm" onClick={onNew}>
            + Новый
          </Button>
          {onToggleCollapse && (
            <button
              className="side-collapse"
              onClick={onToggleCollapse}
              title="Свернуть панель"
              aria-label="Свернуть панель"
            >
              «
            </button>
          )}
        </div>
      </div>
      {onModeChange && (
        <div className="sideswitch" role="group" aria-label="Тип списка">
          <button className={mode === 'chats' ? 'on' : ''} aria-pressed={mode === 'chats'} onClick={() => onModeChange('chats')}>
            Чаты
          </button>
          <button className={mode === 'projects' ? 'on' : ''} aria-pressed={mode === 'projects'} onClick={() => onModeChange('projects')}>
            Проекты
          </button>
        </div>
      )}
      {mode === 'chats' && projects.length > 0 && (
        <div className="sideproject">
          <select
            className="projectselect"
            aria-label="Проект"
            value={selectedProjectId ?? ''}
            onChange={(e) => onSelectProject?.(e.target.value || null)}
          >
            <option value="">Без проекта</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {mode === 'chats' && (<>
      <div className="sidesearch">
        {onSearchScopeChange && (
          <div className="searchscope" role="group" aria-label="Область поиска">
            <button
              className={searchScope === 'chats' ? 'on' : ''}
              aria-pressed={searchScope === 'chats'}
              onClick={() => onSearchScopeChange('chats')}
            >
              Беседы
            </button>
            <button
              className={searchScope === 'messages' ? 'on' : ''}
              aria-pressed={searchScope === 'messages'}
              onClick={() => onSearchScopeChange('messages')}
            >
              Сообщения
            </button>
          </div>
        )}
        <div className="sidesearch-row">
          <input
            className="searchinput"
            type="search"
            value={searchQuery}
            placeholder={inMessages ? 'Поиск по сообщениям…' : 'Поиск по разговорам…'}
            aria-label={inMessages ? 'Поиск по сообщениям' : 'Поиск по разговорам'}
            onChange={(e) => onSearch(e.target.value)}
          />
          {/* Точка входа мышью: без неё про палитру узнают только те, кто угадал
              сочетание. Подпись — та же, что в шпаргалке (⌘ на macOS, Ctrl на остальных). */}
          {onOpenCommandPalette && (
            <IconButton
              className="cmdk-open"
              aria-label="Командная палитра"
              title={`Командная палитра (${formatCombo('mod+k')})`}
              onClick={onOpenCommandPalette}
            >
              {formatCombo('mod+k')}
            </IconButton>
          )}
        </div>
      </div>
      {inMessages ? (
        <MessageResults
          search={messageSearch}
          now={now}
          onPick={(hit) => onPickMessage?.(hit)}
          {...(onRetryMessageSearch ? { onRetry: onRetryMessageSearch } : {})}
          {...(onLoadMoreMessages ? { onLoadMore: onLoadMoreMessages } : {})}
        />
      ) : (
      <div className="convolist">
        {chats.state === 'skeleton' && (
          <div className="convolist-skel" aria-busy="true">
            {/* Высота косточки — высота .convo с названием, метой и статусом. */}
            <Skeleton variant="list" count={5} height={76} lines={3} testId="convo-skeleton" />
          </div>
        )}
        {chats.state === 'error' && (
          <ErrorState
            message="Не удалось загрузить беседы"
            detail={conversationsError}
            {...(onRetryConversations ? { onRetry: onRetryConversations } : {})}
          />
        )}
        {chats.state === 'empty' &&
          (searchQuery.trim() !== '' ? (
            <EmptyState
              compact
              icon="🔍"
              title="Ничего не найдено"
              description="Измените запрос или выберите другой проект в списке над поиском."
            />
          ) : (
            <EmptyState
              icon="💬"
              title="Пока нет бесед — начните первую"
              description="Разговор появится в этом списке и сохранит историю вопросов и ответов."
              actionLabel="Новый разговор"
              onAction={onNew}
            />
          ))}
        {chats.staleError && (
          <ErrorState
            compact
            className="convolist-stale"
            message="Список мог устареть: обновить не удалось"
            detail={conversationsError}
            {...(onRetryConversations ? { onRetry: onRetryConversations } : {})}
          />
        )}
        {chats.refreshing && (
          <p className="convolist-refresh">
            <RefreshIndicator label="Обновляем список…" />
          </p>
        )}
        {/* Список — именно список: скринридер объявляет «список, N элементов» и
            ходит по нему по элементам. role=list висит на обёртке только с
            беседами: скелетон, пустота и баннер ошибки — не элементы списка, и
            внутри list им быть нельзя. */}
        <div className="convo-items" role="list" aria-label="Беседы">
          {conversations.map((c) => (
            <div
              key={c.id}
              role="listitem"
              className={c.id === activeId ? 'convo on' : 'convo'}
              onClick={() => renamingId !== c.id && onPick(c.id)}
            >
              <div className="crow">
                <div className="cinfo">
                  {renamingId === c.id ? (
                    <input
                      className="ctitle-edit"
                      value={renameDraft}
                      autoFocus
                      aria-label="Новое название разговора"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitRename()
                        } else if (e.key === 'Escape') {
                          cancelRename()
                        }
                      }}
                    />
                  ) : (
                    /* Название — настоящая кнопка: строку целиком открывает и
                       клик мышью по любому её месту, но с клавиатуры выбрать
                       беседу иначе было нельзя (div с onClick не фокусируется и
                       не реагирует на Enter). aria-current помечает открытую;
                       aria-selected здесь не годится — он допустим только внутри
                       listbox/grid, а в строке живут свои кнопки и селект статуса,
                       то есть option'ом она быть не может. */
                    <button
                      type="button"
                      className="ctitle"
                      aria-current={c.id === activeId ? 'true' : undefined}
                      onClick={(e) => {
                        e.stopPropagation()
                        onPick(c.id)
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        startRename(c)
                      }}
                    >
                      {c.title}
                    </button>
                  )}
                  <p className="cmeta">{formatMeta(c, now)}</p>
                  {c.messageCount > 0 && (
                    <p className="chat-last-machine" title="Машина последнего сообщения">
                      Последнее: {c.lastExecTarget === 'none' ? 'Без машины' : agents.find((a) => a.id === c.lastExecTarget)?.name ?? 'Сервер'}
                    </p>
                  )}
                  {workingSet.has(c.id) ? (
                    <p className="cstatus on">
                      <span className="cstatus-dot" aria-hidden />
                      {activeStatusLabel(c.permissionMode)}
                    </p>
                  ) : (
                    <select
                      className="cstatus-select"
                      aria-label={`Статус разговора «${c.title}»`}
                      value={c.status ?? DEFAULT_CONVERSATION_STATUS}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation()
                        onStatusChange?.(c.id, e.target.value as ConversationStatus)
                      }}
                    >
                      {CONVERSATION_STATUSES.map((status) => (
                        <option key={status.id} value={status.id}>{status.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                {confirmingId !== c.id && renamingId !== c.id && (
                  <span className="crow-actions">
                    <IconButton
                      size="sm"
                    
                      aria-label={`Переименовать разговор «${c.title}»`}
                      title="Переименовать"
                      onClick={(e) => {
                        e.stopPropagation()
                        startRename(c)
                      }}
                    >
                      ✎
                    </IconButton>
                    <IconButton
                      size="sm"
                      className="vc-btn--danger-quiet"
                    
                      aria-label={`Удалить разговор «${c.title}»`}
                      title="Удалить разговор"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmingId(c.id)
                      }}
                    >
                      ✕
                    </IconButton>
                  </span>
                )}
              </div>
              {confirmingId === c.id && (
                <div className="delconfirm" onClick={(e) => e.stopPropagation()}>
                  <span>Удалить?</span>
                  <Button
                    variant="danger"
                    size="sm"
                  
                    onClick={() => {
                      setConfirmingId(null)
                      onDelete(c.id)
                    }}
                  >
                    Удалить
                  </Button>
                  <Button size="sm" onClick={() => setConfirmingId(null)}>
                    Отмена
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      )}
      </>)}
      {mode === 'projects' && (
        <div className="convolist projlist">
          {onCreateProject &&
            (creatingProject ? (
              <input
                className="login-input projcreate"
                autoFocus
                placeholder="Название проекта"
                aria-label="Название нового проекта"
                value={projectDraft}
                onChange={(e) => setProjectDraft(e.target.value)}
                onBlur={() => setCreatingProject(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && projectDraft.trim()) {
                    onCreateProject(projectDraft.trim())
                    setProjectDraft('')
                    setCreatingProject(false)
                  } else if (e.key === 'Escape') setCreatingProject(false)
                }}
              />
            ) : (
              <button className="projadd" onClick={() => setCreatingProject(true)}>
                + Проект
              </button>
            ))}
          {projects.length === 0 && (
            <EmptyState
              compact
              icon="🗂"
              title="Проектов пока нет"
              description="Создайте первый — доска, задачи и CI появятся внутри него."
            />
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              className={p.id === activeProjectId ? 'convo projitem on' : 'convo projitem'}
              onClick={() => onPickProject?.(p.id)}
            >
              <span className="ctitle">{p.name}</span>
              <span className="projitem-role">{p.role === 'owner' ? 'владелец' : 'участник'}</span>
            </button>
          ))}
        </div>
      )}
      <div className="sidefoot">
        {/* Меню аккаунта: инструменты-виджеты + управление, настройки, выход.
            Иконки виджетов перенесены сюда из отдельного нижнего ряда —
            всплывают по клику на пользователя. */}
        {currentUser && currentUser.name ? (
          <div className="acct" ref={acctRef}>
            <Button
              variant="ghost"
              fullWidth
              className="sidefoot-row acct-toggle"
              
              onClick={() => setAcctOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={acctOpen}
              title={`Роль: ${currentUser.role}`}
            >
              <span className="footico">👤</span>
              <span className="username">{currentUser.name}</span>
              <span className="acct-caret" aria-hidden>▾</span>
            </Button>
            {acctOpen && (
              <div className="acct-menu" role="menu">
                <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenObserver)}>
                  <span className="footico">🤖</span>
                  Агенты
                </Button>
                {onOpenKnowledgeBase && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenKnowledgeBase)}>
                    <span className="footico">📚</span>
                    База знаний
                  </Button>
                )}
                {onOpenFiles && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenFiles)}>
                    <span className="footico">📁</span>
                    Проводник
                  </Button>
                )}
                {onOpenConsole && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenConsole)}>
                    <span className="footico">⌨️</span>
                    Консоль
                  </Button>
                )}
                <div className="acct-sep" aria-hidden />
                {onOpenMachines && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenMachines)}>
                    <span className="footico">🖥</span>
                    Машины
                  </Button>
                )}
                {onOpenCi && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenCi)}>
                    <span className="footico">🧩</span>
                    Команды
                  </Button>
                )}
                {onOpenUsers && currentUser.role === 'admin' && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenUsers)}>
                    <span className="footico">👥</span>
                    Пользователи
                  </Button>
                )}
                <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenSettings)}>
                  <GearIcon />
                  Настройки
                </Button>
                {onLogout && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onLogout)}>
                    <span className="footico">🚪</span>
                    Выйти
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Локальный режим без учётки: нет кнопки пользователя, поэтому
             инструменты остаются компактным рядом иконок + Настройки. */
          <>
            <div className="foottools">
              <IconButton className="foottools-item" onClick={onOpenObserver} title="Агенты (Claude / Codex)" aria-label="Агенты">
                🤖
              </IconButton>
              {onOpenKnowledgeBase && (
                <IconButton className="foottools-item" onClick={onOpenKnowledgeBase} title="База знаний" aria-label="База знаний">
                  📚
                </IconButton>
              )}
              {onOpenFiles && (
                <IconButton className="foottools-item" onClick={onOpenFiles} title="Открыть проводник" aria-label="Открыть проводник">
                  📁
                </IconButton>
              )}
              {onOpenConsole && (
                <IconButton className="foottools-item" onClick={onOpenConsole} title="Открыть консоль" aria-label="Открыть консоль">
                  ⌨️
                </IconButton>
              )}
            </div>
            <Button variant="ghost" fullWidth className="sidefoot-row" onClick={onOpenSettings}>
              <GearIcon />
              Настройки
            </Button>
          </>
        )}
      </div>
    </aside>
  )
}
