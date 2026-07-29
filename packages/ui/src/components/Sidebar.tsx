import { useEffect, useRef, useState } from 'react'
import {
  activeStatusLabel,
  CONVERSATION_STATUSES,
  DEFAULT_CONVERSATION_STATUS,
  type Conversation,
  type ConversationStatus,
  type SessionUser
} from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'
import type { ProjectSummary } from '@shared/projects'
import { ACCENT } from '../lib/view'
import { GearIcon } from './icons'

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

export type SidebarMode = 'chats' | 'projects'

export interface SidebarProps {
  conversations: Conversation[]
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
  /** Мобильный режим: сайдбар выдвинут поверх контента. */
  open?: boolean
  /** Свернуть сайдбар на десктопе (шеврон в шапке); undefined — кнопку не показываем. */
  onToggleCollapse?: () => void
}

export function Sidebar({
  conversations,
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
  currentUser,
  onLogout,
  mode = 'chats',
  onModeChange,
  activeProjectId = null,
  onPickProject,
  onCreateProject,
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
          <button className="newbtn" onClick={onNew}>
            + Новый
          </button>
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
        <input
          className="searchinput"
          type="search"
          value={searchQuery}
          placeholder="Поиск по разговорам…"
          aria-label="Поиск по разговорам"
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <div className="convolist">
        {conversations.length === 0 && searchQuery.trim() !== '' && (
          <p className="convo-empty">Ничего не найдено</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
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
                  <p
                    className="ctitle"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startRename(c)
                    }}
                  >
                    {c.title}
                  </p>
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
                  <button
                    className="renbtn"
                    aria-label={`Переименовать разговор «${c.title}»`}
                    title="Переименовать"
                    onClick={(e) => {
                      e.stopPropagation()
                      startRename(c)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="delbtn"
                    aria-label={`Удалить разговор «${c.title}»`}
                    title="Удалить разговор"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmingId(c.id)
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
            {confirmingId === c.id && (
              <div className="delconfirm" onClick={(e) => e.stopPropagation()}>
                <span>Удалить?</span>
                <button
                  className="delyes"
                  onClick={() => {
                    setConfirmingId(null)
                    onDelete(c.id)
                  }}
                >
                  Удалить
                </button>
                <button className="delno" onClick={() => setConfirmingId(null)}>
                  Отмена
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
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
          {projects.length === 0 && <p className="convo-empty">Проектов пока нет</p>}
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
            <button
              className="footbtn acct-toggle"
              onClick={() => setAcctOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={acctOpen}
              title={`Роль: ${currentUser.role}`}
            >
              <span className="footico">👤</span>
              <span className="username">{currentUser.name}</span>
              <span className="acct-caret" aria-hidden>▾</span>
            </button>
            {acctOpen && (
              <div className="acct-menu" role="menu">
                <button className="footbtn" role="menuitem" onClick={acct(onOpenObserver)}>
                  <span className="footico">🤖</span>
                  Агенты
                </button>
                {onOpenKnowledgeBase && (
                  <button className="footbtn" role="menuitem" onClick={acct(onOpenKnowledgeBase)}>
                    <span className="footico">📚</span>
                    База знаний
                  </button>
                )}
                {onOpenFiles && (
                  <button className="footbtn" role="menuitem" onClick={acct(onOpenFiles)}>
                    <span className="footico">📁</span>
                    Проводник
                  </button>
                )}
                {onOpenConsole && (
                  <button className="footbtn" role="menuitem" onClick={acct(onOpenConsole)}>
                    <span className="footico">⌨️</span>
                    Консоль
                  </button>
                )}
                <div className="acct-sep" aria-hidden />
                {onOpenMachines && (
                  <button className="footbtn" role="menuitem" onClick={acct(onOpenMachines)}>
                    <span className="footico">🖥</span>
                    Машины
                  </button>
                )}
                {onOpenUsers && currentUser.role === 'admin' && (
                  <button className="footbtn" role="menuitem" onClick={acct(onOpenUsers)}>
                    <span className="footico">👥</span>
                    Пользователи
                  </button>
                )}
                <button className="footbtn" role="menuitem" onClick={acct(onOpenSettings)}>
                  <GearIcon />
                  Настройки
                </button>
                {onLogout && (
                  <button className="footbtn" role="menuitem" onClick={acct(onLogout)}>
                    <span className="footico">🚪</span>
                    Выйти
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Локальный режим без учётки: нет кнопки пользователя, поэтому
             инструменты остаются компактным рядом иконок + Настройки. */
          <>
            <div className="foottools">
              <button className="footico-btn" onClick={onOpenObserver} title="Агенты (Claude / Codex)" aria-label="Агенты">
                🤖
              </button>
              {onOpenKnowledgeBase && (
                <button className="footico-btn" onClick={onOpenKnowledgeBase} title="База знаний" aria-label="База знаний">
                  📚
                </button>
              )}
              {onOpenFiles && (
                <button className="footico-btn" onClick={onOpenFiles} title="Открыть проводник" aria-label="Открыть проводник">
                  📁
                </button>
              )}
              {onOpenConsole && (
                <button className="footico-btn" onClick={onOpenConsole} title="Открыть консоль" aria-label="Открыть консоль">
                  ⌨️
                </button>
              )}
            </div>
            <button className="footbtn" onClick={onOpenSettings}>
              <GearIcon />
              Настройки
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
