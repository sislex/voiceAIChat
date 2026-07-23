import { useState } from 'react'
import type { Conversation } from '@shared/types'
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
  now: number
  onNew: () => void
  onPick: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  searchQuery: string
  onSearch: (query: string) => void
  onOpenObserver: () => void
  onOpenCodexObserver: () => void
  onOpenSettings: () => void
}

export function Sidebar({
  conversations,
  activeId,
  now,
  onNew,
  onPick,
  onDelete,
  onRename,
  searchQuery,
  onSearch,
  onOpenObserver,
  onOpenCodexObserver,
  onOpenSettings
}: SidebarProps): JSX.Element {
  // id разговора, для которого показываем инлайн-подтверждение удаления.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // id разговора в режиме переименования + черновик названия.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

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

  return (
    <aside className="side">
      <div className="sidehead">
        <span className="logo">
          <span className="logodot" style={{ background: ACCENT }} />
          Голос·Чат
        </span>
        <button className="newbtn" onClick={onNew}>
          + Новый
        </button>
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
        <button className="footbtn" onClick={onOpenObserver}>
          <span className="footico">🗂</span>
          Claude Code
        </button>
        <button className="footbtn" onClick={onOpenCodexObserver}>
          <span className="footico">🧭</span>
          Codex
        </button>
        <button className="footbtn" onClick={onOpenSettings}>
          <GearIcon />
          Настройки
        </button>
      </div>
    </aside>
  )
}
