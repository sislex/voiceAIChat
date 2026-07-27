import { useEffect, useRef, useState } from 'react'
import type { Conversation, SessionUser } from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'
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
  /** Живой список нужен только для имени машины последнего сообщения. */
  agents?: AgentInfo[]
  searchQuery: string
  onSearch: (query: string) => void
  onOpenObserver: () => void
  onOpenCodexObserver: () => void
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
  /** Открыть режим «Проекты» (web). */
  onOpenProjects?: () => void
  /** Текущий пользователь (web-режим); null/без имени — строка входа не показывается. */
  currentUser?: SessionUser | null
  /** Выйти из сессии (web). */
  onLogout?: () => void
  /** Мобильный режим: сайдбар выдвинут поверх контента. */
  open?: boolean
  /** Свернуть сайдбар на десктопе. */
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
  agents = [],
  searchQuery,
  onSearch,
  onOpenObserver,
  onOpenCodexObserver,
  onOpenKnowledgeBase,
  onOpenSettings,
  onOpenFiles,
  onOpenConsole,
  onOpenUsers,
  onOpenMachines,
  onOpenProjects,
  currentUser,
  onLogout,
  open = false,
  onToggleCollapse
}: SidebarProps): JSX.Element {
  // id разговора, для которого показываем инлайн-подтверждение удаления.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // id разговора в режиме переименования + черновик названия.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [acctOpen, setAcctOpen] = useState(false)
  const acctRef = useRef<HTMLDivElement | null>(null)
  const workingSet = new Set(workingIds)

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
                <p className={workingSet.has(c.id) ? 'cstatus on' : 'cstatus'}>
                  <span className="cstatus-dot" aria-hidden />
                  {workingSet.has(c.id) ? 'идёт работа' : 'не ведётся'}
                </p>
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
      <div className="sidefoot">
        {/* Инструменты — компактный ряд иконок (подписи в title). */}
        <div className="foottools">
          <button className="footico-btn" onClick={onOpenObserver} title="Claude Code" aria-label="Claude Code">
            🗂
          </button>
          <button className="footico-btn" onClick={onOpenCodexObserver} title="Codex" aria-label="Codex">
            🧭
          </button>
          {onOpenProjects && (
            <button className="footico-btn" onClick={onOpenProjects} title="Проекты" aria-label="Проекты">
              📋
            </button>
          )}
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

        {/* Меню аккаунта: управление (машины/пользователи), настройки, выход. */}
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
          /* Локальный режим без учётки: меню аккаунта не нужно — только Настройки. */
          <button className="footbtn" onClick={onOpenSettings}>
            <GearIcon />
            Настройки
          </button>
        )}
      </div>
    </aside>
  )
}
