import { useEffect, useState, type ReactNode } from 'react'
import type {
  AdminLlmEngine,
  AdminLlmEngineHealth,
  AdminLlmEngineInput,
  ModelPrice,
  ModelPriceInput,
  AdminUserInfo,
  UsageReport,
  UsageUnit,
  UserUsageSummary,
  AdminMakeStats
} from '@shared/admin'
import { CLAUDE_MODELS, CODEX_MODELS } from '@shared/types'
import type { Conversation, Message, LlmProvider } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import { Button, Dialog, Skeleton, RefreshIndicator, EmptyState, ErrorState, ConfirmDialog } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from './loadState'

function AdminFrame({ variant, onClose, children }: { variant: 'modal' | 'page'; onClose: () => void; children: ReactNode }): JSX.Element {
  return variant === 'modal'
    ? <Dialog title="Пользователи" size="full" onClose={onClose} testId="users-overlay"><div className="admin-frame">{children}</div></Dialog>
    : <section className="admin-page" aria-label="Пользователи" data-testid="users-overlay"><header className="admin-head"><h2>Пользователи</h2><Button onClick={onClose}>Закрыть</Button></header>{children}</section>
}

export interface UsersAdminProps {
  variant?: 'modal' | 'page'
  users: AdminUserInfo[]
  usageSummary?: UserUsageSummary[]
  /** Метрики Make (п.38): место, публикации, просмотры — секция дашборда для админа. */
  makeStats?: AdminMakeStats | null
  /** Обычный пользователь видит только собственную статистику без машин и админских действий. */
  isAdmin?: boolean
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
  onCreate: (name: string, password: string, role: import('@shared/types').UserRole) => void
  onUpdateRole?: (name: string, role: import('@shared/types').UserRole) => void
  onSetBlocked: (name: string, blocked: boolean) => void
  onDelete: (name: string) => void
  onLoadUsage: (unit: UsageUnit, from?: number, to?: number, conversationId?: string) => void
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
  modelPrices?: ModelPrice[]
  onSaveModelPrice?: (input: ModelPriceInput) => void
  onDeleteModelPrice?: (provider: string, model: string) => void
  llmAccess?: UserLlmAccess[]
  onSaveLlmAccess?: (access: UserLlmAccess[]) => void
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

/** Не выдаём известную часть суммы за цену ответа с неизвестным тарифом. */
function mb(n: number): string { return n < 1048576 ? `${Math.round(n / 1024)} КБ` : `${(n / 1048576).toFixed(1)} МБ` }

function displayedUsd(n: number, costIncomplete?: boolean): string {
  return costIncomplete ? '—' : usd(n)
}

const EMPTY_ENGINE: AdminLlmEngineInput = {
  name: '',
  kind: 'claude',
  baseUrl: '',
  token: '',
  enabled: true,
  allowedRoles: ['admin', 'developer', 'tester', 'observer'],
  isDefault: false
}

// Пустые значения по умолчанию — модульные константы, а не литералы в параметрах.
// Литерал создаёт новый массив на каждый рендер: `llmAccess` стоит в зависимостях
// эффекта, который синхронизирует черновик доступа, поэтому эффект срабатывал
// каждый рендер, звал setAccessDraft и зацикливал компонент. Проявлялось это
// зависанием UsersAdmin.dom.test.tsx (пропс там не передают) — файл вешал весь
// ui-набор, а неработающий гейт рана этого не показывал.
const NO_LLM_ACCESS: UserLlmAccess[] = []
const NO_USAGE_SUMMARY: UserUsageSummary[] = []
const EMPTY_PRICE: ModelPriceInput = { provider: 'codex', model: '', inputPerMillion: 0, cachedInputPerMillion: 0, cacheWritePerMillion: 0, outputPerMillion: 0, sourceUrl: '', effectiveAt: Date.now() }

export function UsersAdmin({
  users,
  usageSummary = NO_USAGE_SUMMARY,
  makeStats = null,
  isAdmin = true,
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
  onUpdateRole = () => undefined,
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
  modelPrices = [],
  onSaveModelPrice = () => undefined,
  onDeleteModelPrice = () => undefined,
  llmAccess = NO_LLM_ACCESS,
  onSaveLlmAccess = () => undefined,
  onClose,
  variant = 'modal'
}: UsersAdminProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newRole, setNewRole] = useState<import('@shared/types').UserRole>('developer')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [confirmBlock, setConfirmBlock] = useState<{ name: string; blocked: boolean } | null>(null)
  const [usageDays, setUsageDays] = useState<7 | 30 | null>(30)
  const [usageConversationId, setUsageConversationId] = useState('')
  const [engineDraft, setEngineDraft] = useState<AdminLlmEngineInput>(EMPTY_ENGINE)
  const [editingEngineId, setEditingEngineId] = useState<string | null>(null)
  const [confirmEngineDelete, setConfirmEngineDelete] = useState<string | null>(null)
  const [accessDraft, setAccessDraft] = useState<UserLlmAccess[]>([])
  const [priceDraft, setPriceDraft] = useState<ModelPriceInput>(EMPTY_PRICE)
  const [editingPrice, setEditingPrice] = useState<string | null>(null)
  const [tab, setTab] = useState<'access' | 'machines' | 'usage' | 'history'>('usage')
  useEffect(() => setAccessDraft(llmAccess), [selected, llmAccess])
  const accessDenied = (provider: LlmProvider, modelId: string): boolean => accessDraft.some((entry) => entry.provider === provider && (entry.modelId === '*' || entry.modelId === modelId))
  const providerAllowed = (provider: LlmProvider): boolean => !accessDraft.some((entry) => entry.provider === provider && entry.modelId === '*')
  const toggleAccess = (provider: LlmProvider, modelId: string, checked: boolean): void => {
    setAccessDraft((prev) => {
      const without = prev.filter((entry) => !(entry.provider === provider && (entry.modelId === modelId || (modelId === '*' && entry.modelId === '*'))))
      return checked ? without : [...without, { provider, modelId }]
    })
  }

  const cur = users.find((u) => u.name === selected) ?? null
  const summaryFor = (name: string): UserUsageSummary | undefined => usageSummary.find((item) => item.name === name)
  // Сервер возвращает список разговоров периода даже при активном фильтре,
  // поэтому варианты селекта не зависят от загруженной истории пользователя.
  const usageConversations = usage?.byConversation ?? conversations
  const view = loadView(status, users.length > 0)
  const enginesView = loadView(enginesStatus, engines.length > 0)
  const canManage = (name: string): boolean => name !== 'admin' && name !== currentUserName
  const loadUsage = (unit: UsageUnit, days: 7 | 30 | null = usageDays, conversationId = usageConversationId): void => {
    const to = Date.now()
    onLoadUsage(unit, days ? to - days * 86_400_000 : undefined, days ? to : undefined, conversationId || undefined)
  }

  const submitCreate = (): void => {
    const n = newName.trim()
    if (!n) return
    onCreate(n, newPass, newRole)
    setNewName('')
    setNewPass('')
    setNewRole('developer')
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
    <AdminFrame variant={variant} onClose={onClose}>
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
          {isAdmin && <div className="ucreate">
            <p className="ucreate-h">Создать пользователя</p>
            <input className="login-input" placeholder="Логин" aria-label="Логин нового пользователя" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="login-input" type="password" placeholder="Пароль (можно пустой)" aria-label="Пароль нового пользователя" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            <select className="sel" aria-label="Роль нового пользователя" value={newRole} onChange={(e) => setNewRole(e.target.value as import('@shared/types').UserRole)}>
              <option value="developer">developer</option>
              <option value="tester">tester</option>
              <option value="observer">observer</option>
              <option value="admin">admin</option>
            </select>
            <Button variant="primary" disabled={!newName.trim()} onClick={submitCreate}>Создать</Button>
          </div>}
        </nav>

        <div className="cc-col uadmin-detail" data-testid="user-detail">
          {!cur && (
            <section className="uadmin-sec" data-testid="users-dashboard">
              <h3 className="uadmin-h">Дашборд пользователей</h3>
              <table className="utable"><thead><tr><th>Логин</th><th>Роль</th><th>Создан</th><th>Чаты</th><th>Токены</th><th>Стоимость</th><th>Модели</th></tr></thead><tbody>
                {users.map((user) => {
                  const summary = summaryFor(user.name)
                  const tokens = (summary?.totals.inputTokens ?? 0) + (summary?.totals.outputTokens ?? 0) + (summary?.totals.cacheReadTokens ?? 0)
                  return <tr key={user.name} onClick={() => onSelect(user.name)} style={{ cursor: 'pointer' }} data-testid="user-dashboard-row">
                    <td>{user.name}</td><td>{user.role}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td>{user.conversationCount}</td>
                    <td>{kilo(tokens)}</td><td>{displayedUsd(summary?.totals.costUsd ?? 0, summary?.totals.costIncomplete)}</td>
                    <td>{summary?.byModel.map((model) => model.model).join(', ') || '—'}</td>
                  </tr>
                })}
              </tbody></table>
            </section>
          )}
          {isAdmin && !cur && makeStats && (
            <section className="uadmin-sec" data-testid="make-stats">
              <h3 className="uadmin-h">Make-проекты</h3>
              <p className="uusage-note">Проектов: {makeStats.projects} · занято {mb(makeStats.bytes)} (файлы {mb(makeStats.filesBytes)}, снимки {mb(makeStats.snapshotsBytes)}, PNG стори {mb(makeStats.shotsBytes)}) · опубликовано {makeStats.published} · read-only ссылок {makeStats.shared} · просмотров публикаций {makeStats.views} · квота на проект {mb(makeStats.limitBytes)}</p>
              {makeStats.byUser.length > 0 && (
                <table className="utable"><thead><tr><th>Пользователь</th><th>Проектов</th><th>Занято</th><th>Опубликовано</th><th>Просмотров</th></tr></thead><tbody>
                  {makeStats.byUser.map((u) => <tr key={u.user}><td>{u.user}</td><td>{u.projects}</td><td>{mb(u.bytes)}</td><td>{u.published}</td><td>{u.views}</td></tr>)}
                </tbody></table>
              )}
              {makeStats.top.length > 0 && (
                <details className="uusage-details"><summary>Самые тяжёлые проекты ({makeStats.top.length})</summary>
                  <table className="utable"><thead><tr><th>Проект</th><th>Владелец</th><th>Файлов</th><th>Снимков</th><th>Занято</th><th>Публикация</th></tr></thead><tbody>
                    {makeStats.top.map((p) => <tr key={p.conversationId}><td><code>{p.conversationId.slice(0, 8)}</code></td><td>{p.owner ?? '—'}</td><td>{p.filesCount}</td><td>{p.snapshots}</td><td>{mb(p.bytes)}</td><td>{p.published ? `да · ${p.views} просм.` : '—'}{p.shared ? ' · read-only' : ''}</td></tr>)}
                  </tbody></table>
                </details>
              )}
            </section>
          )}
          {cur && (
            <>
              <div className="uadmin-head">
                <span className="uadmin-title">{cur.name} <span className="cc-sub">({cur.role})</span></span>
                <span className="uadmin-actions">
                  {canManage(cur.name) && (
                    <>
                      <select aria-label="Роль пользователя" value={cur.role} onChange={(event) => onUpdateRole(cur.name, event.target.value as import('@shared/types').UserRole)}><option value="admin">admin</option><option value="developer">developer</option><option value="tester">tester</option><option value="observer">observer</option></select>
                      <Button size="sm" onClick={() => setConfirmBlock({ name: cur.name, blocked: !cur.blocked })}>{cur.blocked ? 'Разблокировать' : 'Заблокировать'}</Button>
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

              <div className="useg" role="tablist" aria-label="Статистика пользователя">
                <button type="button" role="tab" aria-selected={tab === 'access'} className={tab === 'access' ? 'useg-item on' : 'useg-item'} onClick={() => setTab('access')}>Доступ к моделям</button>
                {isAdmin && <button type="button" role="tab" aria-selected={tab === 'machines'} className={tab === 'machines' ? 'useg-item on' : 'useg-item'} onClick={() => setTab('machines')}>Машины пользователя</button>}
                <button type="button" role="tab" aria-selected={tab === 'usage'} className={tab === 'usage' ? 'useg-item on' : 'useg-item'} onClick={() => setTab('usage')}>Использование моделей</button>
                <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'useg-item on' : 'useg-item'} onClick={() => setTab('history')}>История</button>
              </div>

              {isAdmin && tab === 'machines' && <section className="uadmin-sec">
                <h3 className="uadmin-h">Машины ({cur.agents.length})</h3>
                {cur.agents.length === 0 && <EmptyState compact icon="💻" title="Машин нет" description="Появятся, когда пользователь установит агента командой из меню «Машины»." />}
                {cur.agents.map((a) => (
                  <p key={a.id} className="uagent">
                    <span className={`exectarget-dot ${a.online ? 'remote' : 'server'}`} aria-hidden />
                    {a.name} — {a.online ? 'в сети' : 'офлайн'}
                  </p>
                ))}
              </section>}

              {tab === 'access' && <section className="uadmin-sec" data-testid="user-llm-access">
                <div className="uusage-heading"><div><h3 className="uadmin-h">Доступ к моделям</h3><p className="uusage-note">Пустые права означают полный доступ.</p></div>{isAdmin && <Button variant="primary" size="sm" onClick={() => onSaveLlmAccess(accessDraft)}>Сохранить</Button>}</div>
                <table className="utable"><thead><tr><th>Движок</th><th>Модель</th><th>Доступ</th></tr></thead><tbody>
                  {([{ provider: 'claude' as const, label: 'Claude', models: CLAUDE_MODELS }, { provider: 'codex' as const, label: 'Codex', models: CODEX_MODELS }]).map((group) => <>
                    <tr key={group.provider}><th colSpan={2}>{group.label}</th><td><label><input type="checkbox" aria-label="Доступ к движку" disabled={!isAdmin} checked={providerAllowed(group.provider)} onChange={(e) => toggleAccess(group.provider, '*', e.target.checked)} /> доступен</label></td></tr>
                    {group.models.map((model) => <tr key={`${group.provider}-${model.id}`}><td></td><td>{model.label}</td><td><input type="checkbox" aria-label="Доступ к модели" disabled={!isAdmin || !providerAllowed(group.provider)} checked={!accessDenied(group.provider, model.id)} onChange={(e) => toggleAccess(group.provider, model.id, e.target.checked)} /></td></tr>)}
                  </>)}
                </tbody></table>
              </section>}

              {tab === 'usage' && <section className="uadmin-sec uusage" aria-labelledby="usage-heading">
                <div className="uusage-heading">
                  <div><h3 id="usage-heading" className="uadmin-h">Использование моделей</h3><p className="uusage-note">Токены и стоимость ответов за выбранный период</p></div>
                  <div className="uusage-filters">
                    <select aria-label="Период расхода" value={usageDays ?? 'all'} onChange={(e) => {
                      const days = e.target.value === 'all' ? null : Number(e.target.value) as 7 | 30
                      setUsageDays(days)
                      loadUsage(usage?.unit ?? 'day', days)
                    }}><option value="7">7 дней</option><option value="30">30 дней</option><option value="all">Всё время</option></select>
                    <select aria-label="Разговор расхода" value={usageConversationId} onChange={(e) => {
                      setUsageConversationId(e.target.value)
                      loadUsage(usage?.unit ?? 'day', usageDays, e.target.value)
                    }}><option value="">Все разговоры</option>{usageConversations.map((c) => <option key={'conversationId' in c ? c.conversationId : c.id} value={'conversationId' in c ? c.conversationId : c.id}>{c.title}</option>)}</select>
                  </div>
                </div>
                <div className="useg" aria-label="Группировка отчёта">
                  {UNITS.map((u) => (
                    <button key={u.id} className={usage?.unit === u.id ? 'useg-item on' : 'useg-item'} aria-pressed={usage?.unit === u.id} onClick={() => loadUsage(u.id)}>{u.label}</button>
                  ))}
                </div>
                {!usage && <EmptyState compact icon="📊" title="Период не выбран" description="Выберите разбивку выше — покажем токены, стоимость и число ответов." />}
                {usage && (
                  <>
                    <div className="uusage-stats" data-testid="usage-total">
                      <div><span>Вход</span><strong>{kilo(usage.totals.inputTokens)}</strong></div>
                      <div><span>Выход</span><strong>{kilo(usage.totals.outputTokens)}</strong></div>
                      <div><span>Из кэша</span><strong>{kilo(usage.totals.cacheReadTokens)}</strong></div>
                      <div><span>По данным CLI</span><strong>{displayedUsd(usage.totals.costUsd, usage.totals.costIncomplete && usage.totals.costUsd === 0)}</strong></div>
                      <div><span>По прайсу</span><strong title={usage.totals.costIncomplete ? 'Есть ответы без цены CLI и строки прайса' : undefined}>{displayedUsd(usage.totals.costFromPrices ?? 0, usage.totals.costIncomplete && (usage.totals.costFromPrices ?? 0) === 0)}</strong></div>
                      <div><span>Ответы</span><strong>{usage.totals.messages}</strong></div>
                    </div>
                    <div className="uusage-grid">
                      <div><h4>По моделям</h4><table className="utable"><thead><tr><th>Модель</th><th>Вход</th><th>Выход</th><th>По данным CLI</th><th>По прайсу</th></tr></thead><tbody>{usage.byModel.map((m) => <tr key={m.model}><td>{m.model}</td><td>{kilo(m.inputTokens)}</td><td>{kilo(m.outputTokens)}</td><td>{displayedUsd(m.costUsd, m.costIncomplete && m.costUsd === 0)}</td><td>{displayedUsd(m.costFromPrices ?? 0, m.costIncomplete && (m.costFromPrices ?? 0) === 0)}</td></tr>)}</tbody></table></div>
                      <div><h4>Динамика (UTC)</h4><table className="utable"><thead><tr><th>Период</th><th>Вход</th><th>Выход</th><th>По данным CLI</th><th>По прайсу</th></tr></thead><tbody>{usage.byBucket.map((b) => <tr key={b.bucket}><td>{b.bucket}</td><td>{kilo(b.inputTokens)}</td><td>{kilo(b.outputTokens)}</td><td>{displayedUsd(b.costUsd, b.costIncomplete && b.costUsd === 0)}</td><td>{displayedUsd(b.costFromPrices ?? 0, b.costIncomplete && (b.costFromPrices ?? 0) === 0)}</td></tr>)}</tbody></table></div>
                    </div>
                  </>
                )}
              </section>}

              {tab === 'history' && <section className="uadmin-sec">
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
              </section>}
            </>
          )}

          {isAdmin && <section className="uadmin-sec" data-testid="llm-engines-section">
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
              {(['developer', 'tester', 'observer'] as const).map((role) => <label key={role} className="cc-sub"><input type="checkbox" checked={engineDraft.allowedRoles.includes(role)} onChange={(e) => setEngineDraft({ ...engineDraft, allowedRoles: e.target.checked ? Array.from(new Set([...engineDraft.allowedRoles, role])) : engineDraft.allowedRoles.filter((item) => item !== role) })} /> {role}</label>) }
              <div className="uadmin-actions">
                <Button variant="primary" disabled={!engineDraft.name.trim() || !engineDraft.baseUrl.trim() || engineDraft.allowedRoles.length === 0} onClick={submitEngine}>{editingEngineId ? 'Сохранить' : 'Добавить'}</Button>
                {editingEngineId && <Button onClick={resetEngineForm}>Отмена</Button>}
              </div>
            </div>
          </section>}
          {isAdmin && <section className="uadmin-sec" data-testid="model-prices-section">
            <h3 className="uadmin-h">Стоимость моделей</h3>
            <table className="utable"><thead><tr><th>Провайдер / модель</th><th>Вход</th><th>Кэш</th><th>Запись кэша</th><th>Выход</th><th>Источник / дата</th><th>Действия</th></tr></thead><tbody>
              {modelPrices.map((price) => <tr key={price.provider + price.model}><td>{price.provider} / {price.model}</td><td>{price.inputPerMillion}</td><td>{price.cachedInputPerMillion}</td><td>{price.cacheWritePerMillion}</td><td>{price.outputPerMillion}</td><td><a href={price.sourceUrl} target="_blank" rel="noreferrer">источник</a> · {new Date(price.effectiveAt).toLocaleDateString()}</td><td><Button size="sm" onClick={() => { setEditingPrice(price.provider + price.model); setPriceDraft({ provider: price.provider, model: price.model, inputPerMillion: price.inputPerMillion, cachedInputPerMillion: price.cachedInputPerMillion, cacheWritePerMillion: price.cacheWritePerMillion, outputPerMillion: price.outputPerMillion, sourceUrl: price.sourceUrl, effectiveAt: price.effectiveAt }) }}>Править</Button><Button variant="danger" size="sm" onClick={() => onDeleteModelPrice(price.provider, price.model)}>Удалить</Button></td></tr>)}
            </tbody></table>
            <div className="ucreate"><p className="ucreate-h">{editingPrice ? 'Править цену' : 'Добавить цену'}</p>
              <input className="login-input" aria-label="Провайдер цены" placeholder="claude" value={priceDraft.provider} onChange={(e) => setPriceDraft({ ...priceDraft, provider: e.target.value })} />
              <input className="login-input" aria-label="Модель цены" placeholder="claude-opus" value={priceDraft.model} onChange={(e) => setPriceDraft({ ...priceDraft, model: e.target.value })} />
              {([['inputPerMillion', 'Вход'], ['cachedInputPerMillion', 'Кэш'], ['cacheWritePerMillion', 'Запись кэша'], ['outputPerMillion', 'Выход']] as const).map(([field, label]) => <input key={field} className="login-input" aria-label={label + ' USD за миллион'} type="number" min="0" value={priceDraft[field]} onChange={(e) => setPriceDraft({ ...priceDraft, [field]: Number(e.target.value) })} />)}
              <input className="login-input" aria-label="Источник цены" placeholder="https://…" value={priceDraft.sourceUrl} onChange={(e) => setPriceDraft({ ...priceDraft, sourceUrl: e.target.value })} />
              <input className="login-input" aria-label="Дата тарифа" type="date" value={new Date(priceDraft.effectiveAt).toISOString().slice(0, 10)} onChange={(e) => setPriceDraft({ ...priceDraft, effectiveAt: new Date(e.target.value).getTime() })} />
              <div className="uadmin-actions"><Button variant="primary" disabled={!priceDraft.provider.trim() || !priceDraft.model.trim() || !priceDraft.sourceUrl.trim()} onClick={() => { onSaveModelPrice({ ...priceDraft, provider: priceDraft.provider.trim(), model: priceDraft.model.trim(), sourceUrl: priceDraft.sourceUrl.trim() }); setPriceDraft(EMPTY_PRICE); setEditingPrice(null) }}>{editingPrice ? 'Сохранить' : 'Добавить'}</Button>{editingPrice && <Button onClick={() => { setPriceDraft(EMPTY_PRICE); setEditingPrice(null) }}>Отмена</Button>}</div>
            </div>
          </section>}
        </div>
      </div>
      {confirmBlock && <ConfirmDialog title={confirmBlock.blocked ? `Заблокировать ${confirmBlock.name}?` : `Разблокировать ${confirmBlock.name}?`} variant="danger" confirmLabel={confirmBlock.blocked ? 'Заблокировать' : 'Разблокировать'} onConfirm={() => { onSetBlocked(confirmBlock.name, confirmBlock.blocked); setConfirmBlock(null) }} onCancel={() => setConfirmBlock(null)} />}
    </AdminFrame>
  )
}
