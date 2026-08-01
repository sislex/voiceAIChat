import { useState } from 'react'
import type {
  AdminLlmEngine,
  AdminLlmEngineHealth,
  AdminLlmEngineInput,
  AdminUserInfo,
  UsageReport,
  UsageUnit
} from '@shared/admin'
import type { Conversation, Message } from '@shared/types'
import { Button } from './ui/Button'
import { ToolFrame } from './ToolFrame'
import { Skeleton, RefreshIndicator } from './ui/Skeleton'
import { EmptyState } from './ui/EmptyState'
import { ErrorState } from './ui/ErrorState'
import { loadView, type LoadStatus } from '../lib/loadState'

export interface UsersAdminProps {
  variant?: 'modal' | 'page'
  users: AdminUserInfo[]
  status?: LoadStatus
  error?: string | null
  onRetry?: () => void
  selected: string | null
  usage: UsageReport | null
  conversations: Conversation[]
  messages: Message[]
  conversationId: string | null
  currentUserName: string
  onSelect: (name: string) => void
  onCreate: (name: string, password: string, role: 'admin' | 'user') => void
  onSetBlocked: (name: string, blocked: boolean) => void
  onDelete: (name: string) => void
  onLoadUsage: (unit: UsageUnit) => void
  onOpenConversation: (id: string) => void
  engines: AdminLlmEngine[]
  enginesStatus?: LoadStatus
  enginesError?: string | null
  engineHealth: Record<string, AdminLlmEngineHealth | undefined>
  onRetryEngines?: () => void
  onCreateEngine: (input: AdminLlmEngineInput) => void
  onUpdateEngine: (id: string, patch: AdminLlmEngineInput) => void
  onDeleteEngine: (id: string) => void
  onCheckEngineHealth: (id: string) => void
  onClose: () => void
}

const UNITS: { id: UsageUnit; label: string }[] = [
  { id: 'hour', label: 'По часам' },
  { id: 'day', label: 'По дням' },
  { id: 'week', label: 'По неделям' }
]

function kilo(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
}
function usd(n: number): string {
  return `$${n.toFixed(n < 0.1 ? 4 : 2)}`
}

const EMPTY_ENGINE: AdminLlmEngineInput = {
  name: '',
  kind: 'claude',
  baseUrl: '',
  token: '',
  enabled: true,
  allowedRoles: ['admin', 'user'],
  isDefault: false
}

export function UsersAdmin({
  users,
  status = 'ready',
  error = null,
  onRetry,
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
  engines,
  enginesStatus = 'ready',
  enginesError = null,
  engineHealth,
  onRetryEngines,
  onCreateEngine,
  onUpdateEngine,
  onDeleteEngine,
  onCheckEngineHealth,
  onClose,
  variant = 'modal'
}: UsersAdminProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [engineDraft, setEngineDraft] = useState<AdminLlmEngineInput>(EMPTY_ENGINE)
  const [editingEngineId, setEditingEngineId] = useState<string | null>(null)
  const [confirmEngineDelete, setConfirmEngineDelete] = useState<string | null>(null)

  const cur = users.find((u) => u.name === selected) ?? null
  const view = loadView(status, users.length > 0)
  const enginesView = loadView(enginesStatus, engines.length > 0)
  const canManage = (name: string): boolean => name !== 'admin' && name !== currentUserName

  const submitCreate = (): void => {
    const n = newName.trim()
    if (!n) return
    onCreate(n, newPass, newRole)
    setNewName('')
    setNewPass('')
    setNewRole('user')
  }

  const resetEngineForm = (): void => {
    setEditingEngineId(null)
    setEngineDraft(EMPTY_ENGINE)
  }

  const submitEngine = (): void => {
    const payload: AdminLlmEngineInput = {
      ...engineDraft,
      name: engineDraft.name.trim(),
      baseUrl: engineDraft.baseUrl.trim(),
      token: engineDraft.token.trim()
    }
    if (!payload.name || !payload.baseUrl) return
    if (editingEngineId) onUpdateEngine(editingEngineId, payload)
    else onCreateEngine(payload)
    resetEngineForm()
  }

  return (
    <ToolFrame title="Пользователи" variant={variant} onClose={onClose} testId="users-overlay">
      <div className="ccobs-body">
        <nav className="cc-col cc-projects" aria-label="Список пользователей">
          {view.state === 'skeleton' && (
            <Skeleton variant="list" count={4} height={52} lines={2} className="uadmin-skel" testId="user-skeleton" />
          )}
          {view.state === 'error' && (
            <ErrorState message="Не удалось загрузить пользователей" detail={error} {...(onRetry ? { onRetry } : {})} />
          )}
          {view.state === 'empty' && (
            <EmptyState compact icon="👤" title="Пользователей пока нет" description="Создайте первую учётку формой ниже — она сразу сможет войти." />
          )}
          {view.staleError && (
            <ErrorState compact message="Список мог устареть: обновить не удалось" detail={error} {...(onRetry ? { onRetry } : {})} />
          )}
          {view.refreshing && <RefreshIndicator label="Обновляем список…" />}
          {users.map((u) => (
            <button key={u.name} className={u.name === selected ? 'cc-item on' : 'cc-item'} onClick={() => onSelect(u.name)} data-testid="user-item">
              <span className="cc-name">
                {u.name} {u.blocked && <span className="ublock">заблокирован</span>}
              </span>
              <span className="cc-sub">{u.role} · {u.agents.length} маш. · {u.conversationCount} разг.</span>
            </button>
          ))}
          <div className="ucreate">
            <p className="ucreate-h">Создать пользователя</p>
            <input className="login-input" placeholder="Логин" aria-label="Логин нового пользователя" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="login-input" type="password" placeholder="Пароль (можно пустой)" aria-label="Пароль нового пользователя" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            <select className="sel" aria-label="Роль нового пользователя" value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <Button variant="primary" disabled={!newName.trim()} onClick={submitCreate}>Создать</Button>
          </div>
        </nav>

        <div className="cc-col uadmin-detail" data-testid="user-detail">
          {!cur && (
            <EmptyState icon="👤" title="Пользователь не выбран" description="Выберите учётку слева — покажем её машины, расход токенов и историю разговоров." />
          )}
          {cur && (
            <>
              <div className="uadmin-head">
                <span className="uadmin-title">{cur.name} <span className="cc-sub">({cur.role})</span></span>
                <span className="uadmin-actions">
                  {canManage(cur.name) && (
                    <>
                      <Button size="sm" onClick={() => onSetBlocked(cur.name, !cur.blocked)}>{cur.blocked ? 'Разблокировать' : 'Заблокировать'}</Button>
                      {confirmDel === cur.name ? (
                        <>
                          <Button variant="danger" size="sm" onClick={() => onDelete(cur.name)}>Удалить всё</Button>
                          <Button size="sm" onClick={() => setConfirmDel(null)}>Отмена</Button>
                        </>
                      ) : (
                        <Button variant="danger" size="sm" onClick={() => setConfirmDel(cur.name)}>Удалить учётку</Button>
                      )}
                    </>
                  )}
                </span>
              </div>

              <section className="uadmin-sec">
                <h3 className="uadmin-h">Машины ({cur.agents.length})</h3>
                {cur.agents.length === 0 && <EmptyState compact icon="💻" title="Машин нет" description="Появятся, когда пользователь установит агента командой из меню «Машины»." />}
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
                    <button key={u.id} className={usage?.unit === u.id ? 'useg-item on' : 'useg-item'} onClick={() => onLoadUsage(u.id)}>{u.label}</button>
                  ))}
                </div>
                {!usage && <EmptyState compact icon="📊" title="Период не выбран" description="Выберите разбивку выше — покажем токены, стоимость и число ответов." />}
                {usage && (
                  <>
                    <p className="uadmin-total" data-testid="usage-total">Итого: {kilo(usage.totals.inputTokens)} → {kilo(usage.totals.outputTokens)} ток. · {usd(usage.totals.costUsd)} · {usage.totals.messages} отв.</p>
                    <table className="utable">
                      <thead><tr><th>Модель</th><th>вход</th><th>выход</th><th>$</th></tr></thead>
                      <tbody>{usage.byModel.map((m) => <tr key={m.model}><td>{m.model}</td><td>{kilo(m.inputTokens)}</td><td>{kilo(m.outputTokens)}</td><td>{usd(m.costUsd)}</td></tr>)}</tbody>
                    </table>
                    <table className="utable">
                      <thead><tr><th>Период (UTC)</th><th>вход</th><th>выход</th><th>$</th></tr></thead>
                      <tbody>{usage.byBucket.map((b) => <tr key={b.bucket}><td>{b.bucket}</td><td>{kilo(b.inputTokens)}</td><td>{kilo(b.outputTokens)}</td><td>{usd(b.costUsd)}</td></tr>)}</tbody>
                    </table>
                  </>
                )}
              </section>

              <section className="uadmin-sec">
                <h3 className="uadmin-h">История ({conversations.length})</h3>
                {conversations.length === 0 && <EmptyState compact icon="💬" title="Разговоров пока нет" description="Появятся, как только пользователь начнёт первый чат." />}
                {conversations.map((c) => (
                  <button key={c.id} className={c.id === conversationId ? 'cc-item on' : 'cc-item'} onClick={() => onOpenConversation(c.id)}>
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

          <section className="uadmin-sec" data-testid="llm-engines-section">
            <h3 className="uadmin-h">LLM-исполнители</h3>
            {enginesView.state === 'skeleton' && <Skeleton variant="list" count={2} height={66} lines={3} />}
            {enginesView.state === 'error' && <ErrorState compact message="Не удалось загрузить исполнителей" detail={enginesError} {...(onRetryEngines ? { onRetry: onRetryEngines } : {})} />}
            {enginesView.staleError && <ErrorState compact message="Реестр исполнителей мог устареть" detail={enginesError} {...(onRetryEngines ? { onRetry: onRetryEngines } : {})} />}
            {enginesView.refreshing && <RefreshIndicator label="Обновляем исполнителей…" />}
            {engines.length === 0 && enginesView.state !== 'skeleton' && <EmptyState compact icon="🤖" title="Исполнителей пока нет" description="Добавьте URL и токен runner'а: каждая запись обслуживает один kind." />}
            {engines.map((engine) => {
              const health = engineHealth[engine.id]
              return (
                <div key={engine.id} className="cc-item" data-testid="llm-engine-item">
                  <div className="cc-name">{engine.name}</div>
                  <div className="cc-sub">{engine.kind} · роли: {engine.allowedRoles.join(', ')} · {engine.isDefault ? 'default' : 'не default'} · {engine.enabled ? 'enabled' : 'disabled'}</div>
                  <div className="cc-sub">{engine.baseUrl}</div>
                  <div className="cc-sub">health: {health ? (health.available ? 'жив' : 'недоступен') : 'не проверен'}{health ? ` · ${health.detail}` : ''}</div>
                  <div className="uadmin-actions" style={{ marginTop: 8 }}>
                    <Button size="sm" onClick={() => onCheckEngineHealth(engine.id)}>Проверить</Button>
                    <Button size="sm" onClick={() => {
                      setEditingEngineId(engine.id)
                      setEngineDraft({
                        name: engine.name,
                        kind: engine.kind,
                        baseUrl: engine.baseUrl,
                        token: engine.token,
                        enabled: engine.enabled,
                        allowedRoles: [...engine.allowedRoles],
                        isDefault: engine.isDefault
                      })
                    }}>Править</Button>
                    {confirmEngineDelete === engine.id ? (
                      <>
                        <Button variant="danger" size="sm" onClick={() => onDeleteEngine(engine.id)}>Удалить</Button>
                        <Button size="sm" onClick={() => setConfirmEngineDelete(null)}>Отмена</Button>
                      </>
                    ) : (
                      <Button variant="danger" size="sm" onClick={() => setConfirmEngineDelete(engine.id)}>Удалить</Button>
                    )}
                  </div>
                </div>
              )
            })}
            <div className="ucreate">
              <p className="ucreate-h">{editingEngineId ? 'Править исполнителя' : 'Добавить исполнителя'}</p>
              <input className="login-input" placeholder="Название" aria-label="Название исполнителя" value={engineDraft.name} onChange={(e) => setEngineDraft({ ...engineDraft, name: e.target.value })} />
              <select className="sel" aria-label="Kind исполнителя" value={engineDraft.kind} onChange={(e) => setEngineDraft({ ...engineDraft, kind: e.target.value as 'claude' | 'codex' })}>
                <option value="claude">claude</option>
                <option value="codex">codex</option>
              </select>
              <input className="login-input" placeholder="http://runner:8080" aria-label="URL исполнителя" value={engineDraft.baseUrl} onChange={(e) => setEngineDraft({ ...engineDraft, baseUrl: e.target.value })} />
              <input className="login-input" placeholder="Bearer token" aria-label="Токен исполнителя" value={engineDraft.token} onChange={(e) => setEngineDraft({ ...engineDraft, token: e.target.value })} />
              <label className="cc-sub"><input type="checkbox" checked={engineDraft.enabled} onChange={(e) => setEngineDraft({ ...engineDraft, enabled: e.target.checked })} /> enabled</label>
              <label className="cc-sub"><input type="checkbox" checked={engineDraft.isDefault} onChange={(e) => setEngineDraft({ ...engineDraft, isDefault: e.target.checked })} /> default для kind</label>
              <label className="cc-sub"><input type="checkbox" checked={engineDraft.allowedRoles.includes('admin')} onChange={(e) => setEngineDraft({ ...engineDraft, allowedRoles: e.target.checked ? Array.from(new Set([...engineDraft.allowedRoles, 'admin'])) : engineDraft.allowedRoles.filter((role) => role !== 'admin') })} /> admin</label>
              <label className="cc-sub"><input type="checkbox" checked={engineDraft.allowedRoles.includes('user')} onChange={(e) => setEngineDraft({ ...engineDraft, allowedRoles: e.target.checked ? Array.from(new Set([...engineDraft.allowedRoles, 'user'])) : engineDraft.allowedRoles.filter((role) => role !== 'user') })} /> user</label>
              <div className="uadmin-actions">
                <Button variant="primary" disabled={!engineDraft.name.trim() || !engineDraft.baseUrl.trim() || engineDraft.allowedRoles.length === 0} onClick={submitEngine}>{editingEngineId ? 'Сохранить' : 'Добавить'}</Button>
                {editingEngineId && <Button onClick={resetEngineForm}>Отмена</Button>}
              </div>
            </div>
          </section>
        </div>
      </div>
    </ToolFrame>
  )
}
