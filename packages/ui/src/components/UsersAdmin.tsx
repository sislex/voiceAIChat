import { useState, type MouseEvent } from 'react'
import type { AdminUserInfo, UsageReport, UsageUnit } from '@shared/admin'
import type { Conversation, Message } from '@shared/types'

export interface UsersAdminProps {
  users: AdminUserInfo[]
  selected: string | null
  usage: UsageReport | null
  conversations: Conversation[]
  messages: Message[]
  conversationId: string | null
  /** Текущий админ (нельзя удалить себя/admin). */
  currentUserName: string
  onSelect: (name: string) => void
  onCreate: (name: string, password: string, role: 'admin' | 'user') => void
  onSetBlocked: (name: string, blocked: boolean) => void
  onDelete: (name: string) => void
  onLoadUsage: (unit: UsageUnit) => void
  onOpenConversation: (id: string) => void
  onClose: () => void
}

const UNITS: { id: UsageUnit; label: string }[] = [
  { id: 'hour', label: 'По часам' },
  { id: 'day', label: 'По дням' },
  { id: 'week', label: 'По неделям' }
]

/** Число токенов: 1.2k / 12k. */
function kilo(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}
function usd(n: number): string {
  return `$${n.toFixed(n < 0.1 ? 4 : 2)}`
}

export function UsersAdmin({
  users,
  selected,
  usage,
  conversations,
  messages,
  conversationId,
  currentUserName,
  onSelect,
  onCreate,
  onSetBlocked,
  onDelete,
  onLoadUsage,
  onOpenConversation,
  onClose
}: UsersAdminProps): JSX.Element {
  const stop = (e: MouseEvent): void => e.stopPropagation()
  const [newName, setNewName] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const cur = users.find((u) => u.name === selected) ?? null
  const canManage = (name: string): boolean => name !== 'admin' && name !== currentUserName

  const submitCreate = (): void => {
    const n = newName.trim()
    if (!n) return
    onCreate(n, newPass, newRole)
    setNewName('')
    setNewPass('')
    setNewRole('user')
  }

  return (
    <div className="ovl" onClick={onClose} data-testid="users-overlay">
      <div className="ccobs" onClick={stop} role="dialog" aria-label="Пользователи">
        <div className="mdhead">
          <h2 className="mdh">Пользователи</h2>
          <button className="xbtn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="ccobs-body">
          {/* Левая колонка: список + форма создания */}
          <nav className="cc-col cc-projects" aria-label="Список пользователей">
            {users.map((u) => (
              <button
                key={u.name}
                className={u.name === selected ? 'cc-item on' : 'cc-item'}
                onClick={() => onSelect(u.name)}
                data-testid="user-item"
              >
                <span className="cc-name">
                  {u.name} {u.blocked && <span className="ublock">заблокирован</span>}
                </span>
                <span className="cc-sub">
                  {u.role} · {u.agents.length} маш. · {u.conversationCount} разг.
                </span>
              </button>
            ))}
            <div className="ucreate">
              <p className="ucreate-h">Создать пользователя</p>
              <input
                className="login-input"
                placeholder="Логин"
                aria-label="Логин нового пользователя"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className="login-input"
                type="password"
                placeholder="Пароль (можно пустой)"
                aria-label="Пароль нового пользователя"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
              <select
                className="sel"
                aria-label="Роль нового пользователя"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <button className="login-submit" disabled={!newName.trim()} onClick={submitCreate}>
                Создать
              </button>
            </div>
          </nav>

          {/* Правая колонка: детали выбранного пользователя */}
          <div className="cc-col uadmin-detail" data-testid="user-detail">
            {!cur && <p className="cc-empty">Выберите пользователя</p>}
            {cur && (
              <>
                <div className="uadmin-head">
                  <span className="uadmin-title">
                    {cur.name} <span className="cc-sub">({cur.role})</span>
                  </span>
                  <span className="uadmin-actions">
                    {canManage(cur.name) && (
                      <>
                        <button
                          className="footbtn"
                          onClick={() => onSetBlocked(cur.name, !cur.blocked)}
                        >
                          {cur.blocked ? 'Разблокировать' : 'Заблокировать'}
                        </button>
                        {confirmDel === cur.name ? (
                          <>
                            <button className="delyes" onClick={() => onDelete(cur.name)}>
                              Удалить всё
                            </button>
                            <button className="delno" onClick={() => setConfirmDel(null)}>
                              Отмена
                            </button>
                          </>
                        ) : (
                          <button className="delbtn" onClick={() => setConfirmDel(cur.name)}>
                            Удалить учётку
                          </button>
                        )}
                      </>
                    )}
                  </span>
                </div>

                <section className="uadmin-sec">
                  <h3 className="uadmin-h">Машины ({cur.agents.length})</h3>
                  {cur.agents.length === 0 && <p className="cc-empty">Нет машин</p>}
                  {cur.agents.map((a) => (
                    <p key={a.id} className="uagent">
                      <span className={`exectarget-dot ${a.online ? 'remote' : 'server'}`} aria-hidden />
                      {a.name} — {a.online ? 'в сети' : 'офлайн'}
                    </p>
                  ))}
                </section>

                <section className="uadmin-sec">
                  <h3 className="uadmin-h">Токены</h3>
                  <div className="useg">
                    {UNITS.map((u) => (
                      <button
                        key={u.id}
                        className={usage?.unit === u.id ? 'useg-item on' : 'useg-item'}
                        onClick={() => onLoadUsage(u.id)}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>
                  {usage && (
                    <>
                      <p className="uadmin-total" data-testid="usage-total">
                        Итого: {kilo(usage.totals.inputTokens)} → {kilo(usage.totals.outputTokens)} ток.
                        · {usd(usage.totals.costUsd)} · {usage.totals.messages} отв.
                      </p>
                      <table className="utable">
                        <thead>
                          <tr>
                            <th>Модель</th>
                            <th>вход</th>
                            <th>выход</th>
                            <th>$</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usage.byModel.map((m) => (
                            <tr key={m.model}>
                              <td>{m.model}</td>
                              <td>{kilo(m.inputTokens)}</td>
                              <td>{kilo(m.outputTokens)}</td>
                              <td>{usd(m.costUsd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <table className="utable">
                        <thead>
                          <tr>
                            <th>Период (UTC)</th>
                            <th>вход</th>
                            <th>выход</th>
                            <th>$</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usage.byBucket.map((b) => (
                            <tr key={b.bucket}>
                              <td>{b.bucket}</td>
                              <td>{kilo(b.inputTokens)}</td>
                              <td>{kilo(b.outputTokens)}</td>
                              <td>{usd(b.costUsd)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </section>

                <section className="uadmin-sec">
                  <h3 className="uadmin-h">История ({conversations.length})</h3>
                  {conversations.map((c) => (
                    <button
                      key={c.id}
                      className={c.id === conversationId ? 'cc-item on' : 'cc-item'}
                      onClick={() => onOpenConversation(c.id)}
                    >
                      <span className="cc-name">{c.title}</span>
                      <span className="cc-sub">{c.messageCount} сообщений</span>
                    </button>
                  ))}
                  {conversationId && (
                    <div className="uhistory" data-testid="user-history">
                      {messages.map((m) => (
                        <p key={m.id} className={m.role === 'ai' ? 'umsg ai' : 'umsg'}>
                          <span className="umsg-role">{m.role === 'ai' ? 'Ассистент' : m.role}</span>
                          <span className="umsg-text">{m.text}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
