import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import {
  activeStatusLabel,
  chatModeLabel,
  type Conversation,
  type MessageRole,
  type MessageSearchHit,
  type PermissionMode,
  type SessionUser
} from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'
import type { ProjectSummary, TaskChatBadge } from '@shared/projects'
import type { CiRunSummary } from '@shared/ci'
import { ciCardPulse, ciSummaryForTask } from '@shared/ci'
import { TypeIcon } from './kanban/kanbanMeta'
import { ciStatusLabel, ciTone } from './ci/ciFormat'
import { ACCENT } from '../lib/view'
import { splitSnippet } from '../lib/snippet'
import { Button } from '@voicechat/ui-kit'
import { IconButton } from '@voicechat/ui-kit'
import { Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import { ErrorState } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from '../lib/loadState'
import { FilterIcon, GearIcon } from './icons'
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

/** Локальный понедельник 00:00; календарная арифметика сохраняет DST. */
export function localWeekStart(now: number): number {
  const date = new Date(now)
  const daysFromMonday = (date.getDay() + 6) % 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysFromMonday)
  return date.getTime()
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

export const SIDEBAR_MIN_WIDTH = 220
export const SIDEBAR_MAX_WIDTH = 420
const SIDEBAR_WHEEL_THRESHOLD = 18

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
  /**
   * Метки чатов задач по id беседы: ключ и тип задачи. Есть метка — строка
   * отличается от обычного чата всегда, а не только во время рана.
   */
  taskBadges?: Record<string, TaskChatBadge>
  /**
   * Сводки последних CI-ранов по `taskId` — тот же источник, что подсвечивает
   * карточку на доске, поэтому список чатов мигает теми же цветами.
   */
  ciSummaries?: Record<string, CiRunSummary>
  now: number
  onNew: () => void
  onPick: (id: string) => void
  onDelete: (id: string) => void
  /**
   * Режим из общих настроек: разговор со своим `permissionMode === null`
   * наследует его, и подпись карточки должна показывать действующий режим.
   */
  defaultPermissionMode?: PermissionMode
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
  /**
   * Показывать ли чаты задач, завершённых на доске. Фильтрует сервер, поэтому
   * переключатель — запрос списка заново; без колбэка иконки-фильтра нет.
   */
  showDoneTaskChats?: boolean
  onShowDoneTaskChatsChange?: (show: boolean) => void
  /** Проекты пользователя для селекта над поиском. */
  projects?: ProjectSummary[]
  /** Выбранный в сайдбаре проект (null — «Без проекта»). */
  selectedProjectId?: string | null
  /** Сменить выбранный проект (фильтрует список/поиск, влияет на «Новый»). */
  onSelectProject?: (id: string | null) => void
  onOpenObserver: () => void
  onOpenKnowledgeBase?: () => void
  /** Открыть отдельную страницу персонализации текущего пользователя. */
  onOpenPersonalization?: () => void
  onOpenSettings: () => void
  /** Открыть файловый проводник по машине-агенту (web). */
  onOpenFiles?: () => void
  /** Открыть консоль по машине-агенту (web). */
  onOpenConsole?: () => void
  /** Открыть отдельную страницу Web Reader. */
  onOpenWebReader?: () => void
  /** Открыть изолированный Playwright Reader. */
  onOpenPlaywrightReader?: () => void
  /** Открыть инструмент «Консоль с ассистентом». */
  onOpenConsoleReader?: () => void
  /** Инструмент Make — веб-проект с ассистентом. */
  onOpenMake?: () => void
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
  /** Сессии и устройства (auth-roadmap п.4); нет в desktop. */
  onOpenSessions?: () => void
  /** Двухфакторная защита (auth-roadmap п.6); нет в desktop. */
  onOpenTwoFactor?: () => void
  /** Смена своего пароля (auth-roadmap п.12). */
  onOpenChangePassword?: () => void
  /** Аватар пользователя (эмодзи/буквы) из персонализации; null — 👤. */
  avatar?: string | null
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
  /** Текущая ширина desktop-колонки и её обновление при перетаскивании границы. */
  width?: number
  onWidthChange?: (width: number) => void
}

export function Sidebar({
  conversations,
  conversationsStatus = 'ready',
  conversationsError = null,
  onRetryConversations,
  activeId,
  workingIds = [],
  taskBadges = {},
  ciSummaries = {},
  now,
  onNew,
  onPick,
  onDelete,
  defaultPermissionMode = 'bypassPermissions',
  agents = [],
  searchQuery,
  onSearch,
  searchScope = 'chats',
  messageSearch = EMPTY_SEARCH_VIEW,
  onPickMessage,
  onRetryMessageSearch,
  onLoadMoreMessages,
  showDoneTaskChats = false,
  onShowDoneTaskChatsChange,
  projects = [],
  selectedProjectId = null,
  onSelectProject,
  onOpenObserver,
  onOpenKnowledgeBase,
  onOpenPersonalization,
  onOpenSettings,
  onOpenFiles,
  onOpenConsole,
  onOpenWebReader,
  onOpenPlaywrightReader,
  onOpenConsoleReader,
  onOpenMake,
  onOpenUsers,
  onOpenMachines,
  onOpenCi,
  currentUser,
  onLogout,
  onOpenSessions,
  onOpenTwoFactor,
  onOpenChangePassword,
  avatar = null,
  mode = 'chats',
  onModeChange,
  activeProjectId = null,
  onPickProject,
  onCreateProject,
  onOpenCommandPalette,
  open = false,
  onToggleCollapse,
  width = 264,
  onWidthChange
}: SidebarProps): JSX.Element {
  // id разговора, для которого показываем инлайн-подтверждение удаления.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // Открыто ли меню аккаунта (Машины/Пользователи/Настройки/Выйти).
  const [acctOpen, setAcctOpen] = useState(false)
  // Инлайн-форма создания проекта в списке проектов.
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectDraft, setProjectDraft] = useState('')
  const [projectQuery, setProjectQuery] = useState('')
  const [controlsOpen, setControlsOpen] = useState<Record<SidebarMode, boolean>>({ chats: false, projects: false })
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const wheelDeltaRef = useRef(0)
  // Состояние намеренно локальное: remount снова сворачивает старую секцию.
  const [olderOpen, setOlderOpen] = useState(false)
  const acctRef = useRef<HTMLDivElement | null>(null)
  const workingSet = new Set(workingIds)
  const weekStart = localWeekStart(now)
  const currentWeekConversations = conversations.filter((conversation) => conversation.updatedAt >= weekStart)
  const olderConversations = conversations.filter((conversation) => conversation.updatedAt < weekStart)
  // Поиск по сообщениям заменяет список бесед: у панели свои состояния и карточки.
  const inMessages = searchScope === 'messages'
  // Состояния списка бесед по общему правилу: скелетон — только пока данных нет,
  // при повторной загрузке список остаётся на месте (см. lib/loadState.ts).
  const chats = loadView(conversationsStatus, conversations.length > 0)
  const visibleProjects = projects.filter((project) => project.name.toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()))

  const setControlsVisible = (visible: boolean): void => {
    setControlsOpen((current) => current[mode] === visible ? current : { ...current, [mode]: visible })
  }
  const onListWheel = (event: ReactWheelEvent<HTMLElement>): void => {
    const previous = wheelDeltaRef.current
    const changedDirection = previous !== 0 && Math.sign(previous) !== Math.sign(event.deltaY)
    const accumulated = (changedDirection ? 0 : previous) + event.deltaY
    wheelDeltaRef.current = accumulated
    if (Math.abs(accumulated) < SIDEBAR_WHEEL_THRESHOLD) return
    setControlsVisible(accumulated < 0)
    wheelDeltaRef.current = 0
  }
  const clampWidth = (next: number): number => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, next))
  const finishResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (resizeRef.current?.pointerId !== event.pointerId) return
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const resizeByKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 32 : 8
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      onWidthChange?.(clampWidth(width + (event.key === 'ArrowRight' ? step : -step)))
    } else if (event.key === 'Home') {
      event.preventDefault(); onWidthChange?.(SIDEBAR_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault(); onWidthChange?.(SIDEBAR_MAX_WIDTH)
    }
  }

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

  // Пункт меню аккаунта: закрыть меню и выполнить действие.
  const acct = (fn: () => void) => (): void => {
    setAcctOpen(false)
    fn()
  }

  const renderConversation = (c: Conversation): JSX.Element => {
            // Чат задачи виден в списке как задача: ключ, тип и состояние
            // последнего рана. Подсветку считает та же shared-функция, что и
            // для карточки на доске (`jcard--ci-*`), поэтому цвета совпадают;
            // мигает только активный ран, у терминального рамка статичная.
            const badge = taskBadges[c.id]
            const run = badge ? ciSummaries[badge.taskId] : undefined
            const visibleRun = ciSummaryForTask(run, badge?.columnSemantic === 'done')
            const pulse = ciCardPulse(visibleRun)
            return (
            <div
              key={c.id}
              role="listitem"
              className={['convo', c.id === activeId && 'on', badge && 'convo--task', pulse && `convo--ci-${pulse}`]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onPick(c.id)}
            >
              <div className="crow">
                <div className="cinfo">
                  {/* Название — настоящая кнопка: строку целиком открывает и
                     клик мышью по любому её месту, но с клавиатуры выбрать
                     беседу иначе было нельзя (div с onClick не фокусируется и
                     не реагирует на Enter). aria-current помечает открытую;
                     aria-selected здесь не годится — он допустим только внутри
                     listbox/grid, а в строке живут свои кнопки и селект статуса,
                     то есть option'ом она быть не может. */}
                  <button
                    type="button"
                    className="ctitle"
                    aria-current={c.id === activeId ? 'true' : undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      onPick(c.id)
                    }}
                  >
                    {c.title}
                  </button>
                  {badge && (
                    <p className="ctask">
                      <TypeIcon type={badge.type} />
                      <span className="ctask-key">{badge.key}</span>
                      {visibleRun && (
                        <span className={`ci-lozenge ci-lozenge--${ciTone(visibleRun.status)}`} title="Результат задачи">
                          {ciStatusLabel(visibleRun.status)}
                        </span>
                      )}
                      {visibleRun?.latestAttempt?.status === 'cancelled' && <span className="ctask-key">Последняя попытка отменена</span>}
                    </p>
                  )}
                  <p className="cmeta">{formatMeta(c, now)}</p>
                  {c.messageCount > 0 && (
                    <p className="chat-last-machine" title="Машина последнего сообщения">
                      Последнее: {c.lastExecTarget === 'none' ? 'Без машины' : agents.find((a) => a.id === c.lastExecTarget)?.name ?? 'Сервер'}
                    </p>
                  )}
                  {/* Режим чата словом: во время хода — синяя мигающая точка и
                      «идет …», в простое — тот же режим серым и без точки. */}
                  {workingSet.has(c.id) ? (
                    <p className="cstatus on">
                      <span className="cstatus-dot" aria-hidden />
                      {activeStatusLabel(c.permissionMode, defaultPermissionMode, Boolean(c.taskId))}
                    </p>
                  ) : (
                    <p className="cstatus">{chatModeLabel(c.permissionMode, defaultPermissionMode, Boolean(c.taskId))}</p>
                  )}
                </div>
                {confirmingId !== c.id && (
                  <span className="crow-actions">
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
            )

          }

  return (
    <aside id="app-sidebar" className={open ? 'side side--open' : 'side'}>
      <div className="sidehead">
        <span className="logo">
          <span className="logodot" style={{ background: ACCENT }} />
          Голос·Чат
        </span>
        {onToggleCollapse && (
          <button className="side-collapse" onClick={onToggleCollapse} title="Свернуть панель" aria-label="Свернуть панель">«</button>
        )}
      </div>
      <div className="side-primary-action">
        {mode === 'chats' ? (
          <Button fullWidth onClick={onNew}><span aria-hidden>✎</span> Новый чат</Button>
        ) : onCreateProject && (
          creatingProject ? (
            <input
              className="login-input projcreate"
              autoFocus
              placeholder="Название проекта"
              aria-label="Название нового проекта"
              value={projectDraft}
              onChange={(event) => setProjectDraft(event.target.value)}
              onBlur={() => setCreatingProject(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && projectDraft.trim()) {
                  onCreateProject(projectDraft.trim())
                  setProjectDraft('')
                  setCreatingProject(false)
                } else if (event.key === 'Escape') setCreatingProject(false)
              }}
            />
          ) : <Button fullWidth onClick={() => setCreatingProject(true)}>+ Новый проект</Button>
        )}
      </div>
      {onModeChange && (
        <div className="sideswitch" role="group" aria-label="Тип списка">
          <button className={mode === 'chats' ? 'on' : ''} aria-pressed={mode === 'chats'} onClick={() => onModeChange('chats')}>Чаты</button>
          <button className={mode === 'projects' ? 'on' : ''} aria-pressed={mode === 'projects'} onClick={() => onModeChange('projects')}>Проекты</button>
        </div>
      )}
      <div className={controlsOpen[mode] ? 'side-controls side-controls--open' : 'side-controls'} aria-hidden={!controlsOpen[mode]}>
        {mode === 'chats' ? (<>
          {projects.length > 0 && (
            <div className="sideproject">
              <select className="projectselect" aria-label="Проект" value={selectedProjectId ?? ''} onChange={(event) => onSelectProject?.(event.target.value || null)}>
                <option value="">Без проекта</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
          )}
          <div className="sidesearch">
            <div className="sidesearch-row">
              <input className="searchinput" type="search" value={searchQuery} placeholder="Поиск по разговорам…" aria-label="Поиск по разговорам" onChange={(event) => onSearch(event.target.value)} />
              {onShowDoneTaskChatsChange && (
                <IconButton className={showDoneTaskChats ? 'convo-filter on' : 'convo-filter'} aria-label="Показывать чаты завершённых задач" aria-pressed={showDoneTaskChats} title="Показывать чаты завершённых задач" onClick={() => onShowDoneTaskChatsChange(!showDoneTaskChats)}>
                  <FilterIcon />
                </IconButton>
              )}
              {onOpenCommandPalette && (
                <IconButton className="cmdk-open" aria-label="Командная палитра" title={`Командная палитра (${formatCombo('mod+k')})`} onClick={onOpenCommandPalette}>
                  {formatCombo('mod+k')}
                </IconButton>
              )}
            </div>
          </div>
        </>) : (
          <div className="sidesearch">
            <div className="sidesearch-row">
              <input className="searchinput" type="search" value={projectQuery} placeholder="Поиск по проектам…" aria-label="Поиск по проектам" onChange={(event) => setProjectQuery(event.target.value)} />
            </div>
          </div>
        )}
      </div>
      {mode === 'chats' && (<>
      {inMessages ? (
        <MessageResults
          search={messageSearch}
          now={now}
          onPick={(hit) => onPickMessage?.(hit)}
          {...(onRetryMessageSearch ? { onRetry: onRetryMessageSearch } : {})}
          {...(onLoadMoreMessages ? { onLoadMore: onLoadMoreMessages } : {})}
        />
      ) : (
      <div className="convolist" onWheel={onListWheel}>
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
        {/* Глобальные состояния остаются снаружи секций; внутри каждой — только
            корректный role=list с разговорами-listitem. */}
        <div className="convo-groups">
          {currentWeekConversations.length > 0 && (
            <section className="convo-section" aria-labelledby="sidebar-current-week-title">
              <h2 id="sidebar-current-week-title" className="convo-section-title">На этой неделе</h2>
              <div className="convo-items" role="list" aria-label="Беседы">
                {currentWeekConversations.map(renderConversation)}
              </div>
            </section>
          )}
          {olderConversations.length > 0 && (
            <section className="convo-section convo-section--older" aria-labelledby="sidebar-older-title">
              <button
                id="sidebar-older-title"
                type="button"
                className="convo-section-toggle"
                aria-expanded={olderOpen}
                aria-controls="sidebar-older-conversations"
                onClick={() => setOlderOpen((open) => !open)}
              >
                <span>Более старые</span>
                <span className="convo-section-count">{olderConversations.length}</span>
              </button>
              <div
                id="sidebar-older-conversations"
                className="convo-items"
                role="list"
                aria-label={`Более старые беседы: ${olderConversations.length}`}
                hidden={!olderOpen}
              >
                {olderConversations.map(renderConversation)}
              </div>
            </section>
          )}
        </div>
      </div>
      )}
      </>)}
      {mode === 'projects' && (
        <div className="convolist projlist" onWheel={onListWheel}>
          {visibleProjects.length === 0 && (
            <EmptyState
              compact
              icon="🗂"
              title="Проектов пока нет"
              description="Создайте первый — доска, задачи и CI появятся внутри него."
            />
          )}
          {visibleProjects.map((p) => (
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
              <span className={avatar ? 'footico footico--avatar' : 'footico'} data-testid="account-avatar">{avatar ?? '👤'}</span>
              <span className="username">{currentUser.name}</span>
              <span className="acct-caret" aria-hidden>▾</span>
            </Button>
            {acctOpen && (
              <div className="acct-menu" role="menu">
                <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenObserver)}>
                  <span className="footico">🤖</span>
                  История LLM
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
                {onOpenWebReader && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenWebReader)}>
                    <span className="footico">🌐</span>
                    Web Reader
                  </Button>
                )}
                {onOpenPlaywrightReader && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenPlaywrightReader)}>
                    <span className="footico">▣</span>
                    Playwright Reader
                  </Button>
                )}
                {onOpenConsoleReader && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenConsoleReader)}>
                    <span className="footico">▮</span>
                    Консоль с ассистентом
                  </Button>
                )}
                {onOpenMake && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenMake)}>
                    <span className="footico">✦</span>
                    Make — веб-проект
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
                {onOpenPersonalization && <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenPersonalization)}><span className="footico">✨</span>Персонализация</Button>}
                <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenSettings)}>
                  <GearIcon />
                  Настройки
                </Button>
                {onOpenSessions && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenSessions)}>
                    <span className="footico">📱</span>
                    Сессии и устройства
                  </Button>
                )}
                {onOpenChangePassword && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenChangePassword)}>
                    <span className="footico">🔑</span>
                    Сменить пароль
                  </Button>
                )}
                {onOpenTwoFactor && (
                  <Button variant="ghost" fullWidth className="sidefoot-row" role="menuitem" onClick={acct(onOpenTwoFactor)}>
                    <span className="footico">🔐</span>
                    Двухфакторная защита
                  </Button>
                )}
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
              <IconButton className="foottools-item" onClick={onOpenObserver} title="История LLM" aria-label="История LLM">
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
              {onOpenWebReader && (
                <IconButton className="foottools-item" onClick={onOpenWebReader} title="Web Reader" aria-label="Web Reader">
                  🌐
                </IconButton>
              )}
              {onOpenPlaywrightReader && (
                <IconButton className="foottools-item" onClick={onOpenPlaywrightReader} title="Playwright Reader" aria-label="Playwright Reader">
                  ▣
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
      {onWidthChange && (
        <div
          className="side-resize"
          role="separator"
          aria-label="Изменить ширину сайдбара"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          onKeyDown={resizeByKeyboard}
          onPointerDown={(event) => {
            resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
            event.currentTarget.setPointerCapture?.(event.pointerId)
          }}
          onPointerMove={(event) => {
            const drag = resizeRef.current
            if (drag?.pointerId === event.pointerId) onWidthChange(clampWidth(drag.startWidth + event.clientX - drag.startX))
          }}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onLostPointerCapture={() => { resizeRef.current = null }}
        />
      )}
    </aside>
  )
}
