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
  onOpenSettings: () => void
}

export function Sidebar({
  conversations,
  activeId,
  now,
  onNew,
  onPick,
  onDelete,
  onOpenSettings
}: SidebarProps): JSX.Element {
  // id разговора, для которого показываем инлайн-подтверждение удаления.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

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
      <div className="convolist">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={c.id === activeId ? 'convo on' : 'convo'}
            onClick={() => onPick(c.id)}
          >
            <div className="crow">
              <div className="cinfo">
                <p className="ctitle">{c.title}</p>
                <p className="cmeta">{formatMeta(c, now)}</p>
              </div>
              {confirmingId !== c.id && (
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
        <button className="footbtn" onClick={onOpenSettings}>
          <GearIcon />
          Настройки
        </button>
      </div>
    </aside>
  )
}
