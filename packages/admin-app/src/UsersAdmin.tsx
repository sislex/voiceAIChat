import { useEffect, useState, type ReactNode } from 'react'
import { ProjectTypesAdmin } from './ProjectTypesAdmin'
import type { ProjectTypeNode } from '@shared/projectTypes'
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
  AdminMakeStats, AdminMachineStats, SecurityEvent, SecurityEventType, InviteInfo, SignupConfig } from '@shared/admin'
import { CLAUDE_MODELS, CODEX_MODELS } from '@shared/types'
import type { Conversation, Message, LlmProvider } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import { AgentFleetUpdate } from './AgentFleetUpdate'
import type { SessionsClient } from '@voicechat/sessions-app'
import { AdminSessions } from './AdminSessions'
import { RoleCommandPolicyEditor } from './RoleCommandPolicyEditor'
import type { RoleCommandPolicies } from '@shared/commandPolicy'
import { Button, Dialog, Skeleton, RefreshIndicator, EmptyState, ErrorState, ConfirmDialog } from '@voicechat/ui-kit'
import { loadView, type LoadStatus } from './loadState'
import { formatDate } from '@shared/dateFormat'

function AdminFrame({ variant, onClose, children }: { variant: 'modal' | 'page'; onClose: () => void; children: ReactNode }): JSX.Element {
  return variant === 'modal'
    ? <Dialog title="Пользователи" size="full" onClose={onClose} testId="users-overlay"><div className="admin-frame">{children}</div></Dialog>
    : <section className="admin-page" aria-label="Пользователи" data-testid="users-overlay"><header className="admin-head"><h2>Пользователи</h2><Button onClick={onClose}>Закрыть</Button></header>{children}</section>
}

/** Подписи событий журнала безопасности (auth-roadmap п.7). */
const SECURITY_LABEL: Record<SecurityEventType, string> = { agent_connected: 'Агент подключился', agent_rejected: 'Агент отклонён', agent_token_rotated: 'Токен агента перевыпущен', agent_token_revoked: 'Токен агента отозван', signup_requested: 'Заявка на регистрацию', signup_verified: 'Email подтверждён', login_new_device: 'Вход с нового устройства', inactive_blocked: 'Отключён за неактивность', reset_code_issued: 'Выдан код сброса', password_reset: 'Пароль сброшен по коду', password_changed: 'Пароль изменён', invite_created: 'Создан инвайт', project_invited: 'Приглашение в проект', project_invite_accepted: 'Приглашение принято', registered: 'Регистрация по инвайту', login: 'Вход', login_failed: 'Неверный пароль', login_locked: 'Замок после неудач', login_2fa_failed: 'Неверный код 2FA', logout: 'Выход', logout_all: 'Выход везде', session_revoked: 'Сессия отозвана', session_renamed: 'Устройство переименовано', session_trusted: 'Устройство доверено', session_untrusted: 'Доверие снято', session_evicted: 'Сессия вытеснена лимитом', session_panic: 'Тревога: «это не я»', password_set: 'Пароль установлен', twofactor_enabled: '2FA включена', twofactor_disabled: '2FA выключена', user_blocked: 'Заблокирован', user_unblocked: 'Разблокирован' }

export interface UsersAdminProps {
  variant?: 'modal' | 'page'
  users: AdminUserInfo[]
  usageSummary?: UserUsageSummary[]
  /** Метрики Make (п.38): место, публикации, просмотры — секция дашборда для админа. */
  makeStats?: AdminMakeStats | null
  /** Метрики машин (machines-roadmap п.5). */
  machineStats?: AdminMachineStats | null
  /** Ролевые правила команд (п.10): текущие и сохранение. */
  roleCommandPolicies?: RoleCommandPolicies | null
  onSaveRoleCommandPolicies?: (roles: RoleCommandPolicies) => Promise<void>
  /** Обычный пользователь видит только собственную статистику без машин и админских действий. */
  isAdmin?: boolean
  /** Обновление агентов машин (machines-roadmap п.16): актуальная версия и запуск обновления. */
  latestAgentVersion?: string
  onUpdateMachine?: (machineId: string) => Promise<string | null>
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
  onCreate: (name: string, password: string, role: import('@shared/types').UserRole, mustChangePassword?: boolean) => void
  /** Код сброса пароля (auth-roadmap п.10): возвращает код для передачи пользователю. */
  onResetCode?: (name: string) => Promise<{ code: string; expiresAt: number } | null>
  /** Месячный лимит расхода LLM в USD (auth-roadmap п.17). */
  onSetLlmLimit?: (name: string, llmLimitUsd: number | null) => void
  onUpdateRole?: (name: string, role: import('@shared/types').UserRole) => void
  onSetBlocked: (name: string, blocked: boolean) => void
  onDelete: (name: string) => void
  onLoadUsage: (unit: UsageUnit, from?: number, to?: number, conversationId?: string) => void
  /**
   * Доступ к сессиям выбранного пользователя. Список рисует общий модуль
   * «сессии и устройства» — тот же, что видит сам пользователь в своём меню:
   * две разные вёрстки одного списка расходились бы в мелочах.
   */
  sessionsClient?: SessionsClient
  /** Журнал безопасности выбранного пользователя (auth-roadmap п.7). */
  security?: SecurityEvent[] | null
  onLoadSecurity?: () => void
  /** Инвайты на саморегистрацию (auth-roadmap п.8). */
  invites?: InviteInfo[] | null
  onLoadInvites?: () => void
  onCreateInvite?: (input: { role: import('@shared/types').UserRole; ttlHours: number; maxUses: number; note: string; email?: string }) => void
  onDeleteInvite?: (token: string) => void
  /** База абсолютной ссылки инвайта (origin + путь) — admin-app не трогает window, её даёт хост. */
  inviteBaseUrl?: string
  /** Открытая регистрация с подтверждением email. */
  signup?: SignupConfig | null
  onLoadSignup?: () => void
  onSetSignup?: (input: { enabled?: boolean; role?: import('@shared/types').UserRole; ownedProjectLimit?: number; sessionLimit?: number }) => void
  onOpenConversation: (id: string) => void
  /** Типы проекта, ожидающие утверждения; нет обработчика — секции нет. */
  pendingProjectTypes?: ProjectTypeNode[]
  onReviewProjectType?: (input: { id: string; decision: 'approve' | 'reject'; note?: string }) => void | Promise<void>
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
  machineStats = null,
  roleCommandPolicies = null,
  onSaveRoleCommandPolicies,
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
  onResetCode,
  onSetLlmLimit,
  onUpdateRole = () => undefined,
  onSetBlocked,
  onDelete,
  onLoadUsage,
  sessionsClient,
  security,
  onLoadSecurity,
  invites,
  onLoadInvites,
  onCreateInvite,
  onDeleteInvite,
  inviteBaseUrl = '',
  signup,
  onLoadSignup,
  onSetSignup,
  onOpenConversation,
  pendingProjectTypes = [],
  onReviewProjectType,
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
  variant = 'modal', latestAgentVersion, onUpdateMachine }: UsersAdminProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newRole, setNewRole] = useState<import('@shared/types').UserRole>('developer')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [confirmBlock, setConfirmBlock] = useState<{ name: string; blocked: boolean } | null>(null)
  /** Форма инвайта (auth-roadmap п.8). */
  const [inviteRole, setInviteRole] = useState<import('@shared/types').UserRole>('developer')
  const [inviteHours, setInviteHours] = useState(72)
  const [inviteUses, setInviteUses] = useState(1)
  const [inviteNote, setInviteNote] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitesOpen, setInvitesOpen] = useState(false)
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null)
  /** Временный пароль при создании (п.11) и выданный код сброса (п.10). */
  const [newTemp, setNewTemp] = useState(true)
  const [resetInfo, setResetInfo] = useState<{ name: string; code: string; expiresAt: number } | null>(null)
  const [limitDraft, setLimitDraft] = useState<string>('')
  const [usageDays, setUsageDays] = useState<7 | 30 | null>(30)
  const [usageConversationId, setUsageConversationId] = useState('')
  const [engineDraft, setEngineDraft] = useState<AdminLlmEngineInput>(EMPTY_ENGINE)
  const [editingEngineId, setEditingEngineId] = useState<string | null>(null)
  const [confirmEngineDelete, setConfirmEngineDelete] = useState<string | null>(null)
  const [accessDraft, setAccessDraft] = useState<UserLlmAccess[]>([])
  const [priceDraft, setPriceDraft] = useState<ModelPriceInput>(EMPTY_PRICE)
  const [editingPrice, setEditingPrice] = useState<string | null>(null)
  const [tab, setTab] = useState<'access' | 'machines' | 'usage' | 'history' | 'security'>('usage')
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
    onCreate(n, newPass, newRole, newTemp)
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
                {u.name} {u.mustChangePassword && <span className="ublock ublock--lock" title="Временный пароль — сменит при входе">временный пароль</span>}{u.blocked && <span className="ublock" title={u.lockReason === 'auto' ? 'Автоматически: слишком много неверных паролей подряд' : undefined}>{u.lockReason === 'auto' ? 'заблокирован автоматически' : 'заблокирован'}</span>}{!u.blocked && u.lockedUntil && u.lockedUntil > Date.now() && <span className="ublock ublock--lock" title="Временный замок после неудачных входов; снимается сам или разблокировкой">замок до {new Date(u.lockedUntil).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>}
              </span>
              <span className="cc-sub">{u.role} · {u.agents.length} маш. · {u.conversationCount} разг.</span>
            </button>
          ))}
          {isAdmin && <div className="ucreate">
            <p className="ucreate-h">Создать пользователя</p>
            <input className="login-input" placeholder="Логин" aria-label="Логин нового пользователя" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="login-input" type="password" placeholder="Пароль — не короче 10 символов" aria-label="Пароль нового пользователя" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
            <select className="sel" aria-label="Роль нового пользователя" value={newRole} onChange={(e) => setNewRole(e.target.value as import('@shared/types').UserRole)}>
              <option value="developer">developer</option>
              <option value="tester">tester</option>
              <option value="observer">observer</option>
              <option value="admin">admin</option>
            </select>
            <label className="make-autosave" title="Пользователь обязан сменить пароль при первом входе"><input type="checkbox" aria-label="Временный пароль" checked={newTemp} onChange={(e) => setNewTemp(e.target.checked)} /> временный пароль</label>
            <Button variant="primary" disabled={!newName.trim()} onClick={submitCreate}>Создать</Button>
          </div>}
          {onLoadSignup && (
            <details className="uadmin-invites" data-testid="admin-signup" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) onLoadSignup() }}>
              <summary>Открытая регистрация{signup ? (signup.enabled ? ' — включена' : ' — выключена') : ''}</summary>
              {signup && (
                <div className="uadmin-invite-form">
                  <label className="make-autosave"><input type="checkbox" aria-label="Разрешить регистрацию по email" checked={signup.enabled} onChange={(e) => onSetSignup?.({ enabled: e.target.checked })} /> разрешить регистрацию с подтверждением email</label>
                  <label>Роль новых <select aria-label="Роль новых пользователей" value={signup.role} onChange={(e) => onSetSignup?.({ role: e.target.value as import('@shared/types').UserRole })}><option value="developer">developer</option><option value="tester">tester</option><option value="observer">observer</option></select></label>
                  <label>Проектов на пользователя <input type="number" min={1} max={1000} aria-label="Квота проектов на пользователя" value={signup.ownedProjectLimit} onChange={(e) => { const value = Number(e.target.value); if (Number.isInteger(value) && value > 0) onSetSignup?.({ ownedProjectLimit: value }) }} /></label>
                  {/* 0 — без ограничения: лимит сессий выключен по умолчанию, включать его должен человек осознанно. */}
                  <label>Сессий на пользователя <input type="number" min={0} max={100} aria-label="Лимит одновременных сессий (0 — без ограничения)" value={signup.sessionLimit ?? 0} onChange={(e) => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 0 && value <= 100) onSetSignup?.({ sessionLimit: value }) }} /></label>
                  {!signup.mailConfigured && <span className="ublock ublock--lock" title="Задайте VC_SMTP_URL и VC_MAIL_FROM на сервере">SMTP не настроен — письма пишутся в лог сервера</span>}
                </div>
              )}
            </details>
          )}
          {onLoadInvites && (
            <details className="uadmin-invites" data-testid="admin-invites" open={invitesOpen} onToggle={(e) => { const open = (e.currentTarget as HTMLDetailsElement).open; setInvitesOpen(open); if (open) onLoadInvites() }}>
              <summary>Инвайт-ссылки{invites ? ` (${invites.length})` : ''}</summary>
              <form className="uadmin-invite-form" onSubmit={(e) => { e.preventDefault(); onCreateInvite?.({ role: inviteRole, ttlHours: inviteHours, maxUses: inviteUses, note: inviteNote.trim(), ...(inviteEmail.trim() ? { email: inviteEmail.trim() } : {}) }); setInviteNote(''); setInviteEmail('') }}>
                <select aria-label="Роль по инвайту" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as import('@shared/types').UserRole)}><option value="developer">developer</option><option value="tester">tester</option><option value="observer">observer</option><option value="admin">admin</option></select>
                <label>Срок, ч <input type="number" min={1} max={720} aria-label="Срок действия, часов" value={inviteHours} onChange={(e) => setInviteHours(Number(e.target.value) || 1)} /></label>
                <label>Использований <input type="number" min={1} max={100} aria-label="Максимум использований" value={inviteUses} onChange={(e) => setInviteUses(Number(e.target.value) || 1)} /></label>
                <input className="login-input" aria-label="Email получателя" type="email" placeholder="email (необязательно)" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                <input className="login-input" aria-label="Заметка к инвайту" placeholder="для кого (необязательно)" value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} />
                <Button size="sm" variant="primary" type="submit">Создать ссылку</Button>
              </form>
              {invites && invites.length > 0 && (
                <ul className="sessions-list" role="list">
                  {invites.map((inv) => {
                    const url = `${inviteBaseUrl}#/invite/${encodeURIComponent(inv.token)}`
                    const dead = inv.expiresAt < Date.now() || inv.uses >= inv.maxUses
                    return (
                      <li key={inv.token} className={dead ? 'sessions-item invite--dead' : 'sessions-item'}>
                        <div><strong>{inv.role}{inv.note ? ` · ${inv.note}` : ''}</strong><small>{inv.uses}/{inv.maxUses} исп. · до {new Date(inv.expiresAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{dead ? ' · недействителен' : ''}</small>{inv.email && <small>{inv.email} · {inv.emailedAt ? 'email отправлен' : 'email не отправлен'}</small>}<code className="invite-url">{url}</code></div>
                        <span className="uadmin-actions">
                          <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setCopiedInvite(inv.token); setTimeout(() => setCopiedInvite(null), 1500) }) }}>{copiedInvite === inv.token ? 'Скопировано' : 'Копировать'}</Button>
                          {onDeleteInvite && <Button size="sm" variant="ghost" onClick={() => onDeleteInvite(inv.token)}>Отозвать</Button>}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </details>
          )}
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
                    <td>{user.name}</td><td>{user.role}</td><td>{formatDate(user.createdAt)}</td><td>{user.conversationCount}</td>
                    <td>{kilo(tokens)}</td><td>{displayedUsd(summary?.totals.costUsd ?? 0, summary?.totals.costIncomplete)}</td>
                    <td>{summary?.byModel.map((model) => model.model).join(', ') || '—'}</td>
                  </tr>
                })}
              </tbody></table>
            </section>
          )}
          {isAdmin && !cur && machineStats && machineStats.machines.length > 0 && (
            <section className="uadmin-sec" data-testid="machine-stats">
              <div className="uusage-heading"><div><h3 className="uadmin-h">Машины</h3><p className="uusage-note">В сети {machineStats.totals.online} из {machineStats.totals.machines} · команд за 24 ч: {machineStats.totals.commands24h} · с ошибкой: {machineStats.totals.errors24h} · Prometheus: <code>/api/admin/machines/metrics</code></p></div></div>
              <table className="utable"><thead><tr><th>Машина</th><th>Владелец</th><th>Статус</th><th>Команд 24 ч / всего</th><th>Ошибок 24 ч</th><th>Ср. длительность</th><th>Тревог 30 д</th><th>CPU</th><th>Память</th><th>Диск</th></tr></thead><tbody>
                {machineStats.machines.map((m) => (
                  <tr key={m.id} className={m.errors24h > 0 || m.offlineEvents30d > 0 ? 'uadmin-warn' : undefined}>
                    <td>{m.name}{m.version ? ` · v${m.version}` : ''}</td><td>{m.owner}</td><td>{m.online ? 'в сети' : 'офлайн'}</td>
                    <td>{m.commands24h} / {m.commandsTotal}</td><td>{m.errors24h}</td><td>{m.avgDurationMs24h ? `${(m.avgDurationMs24h / 1000).toFixed(1)} с` : '—'}</td>
                    <td>{m.offlineEvents30d}{m.offlineMs30d ? ` (${Math.round(m.offlineMs30d / 60000)} мин)` : ''}</td>
                    <td>{m.cpuLoadPct !== undefined ? `${Math.round(m.cpuLoadPct)}%` : '—'}</td><td>{m.memUsedRatio !== undefined ? `${Math.round(m.memUsedRatio * 100)}%` : '—'}</td><td>{m.diskFreeBytes !== undefined ? `${mb(m.diskFreeBytes)} своб.` : '—'}</td>
                  </tr>
                ))}
              </tbody></table>
            </section>
          )}
          {isAdmin && !cur && roleCommandPolicies && onSaveRoleCommandPolicies && (
            <RoleCommandPolicyEditor roles={roleCommandPolicies} onSave={onSaveRoleCommandPolicies} />
          )}
          {isAdmin && !cur && makeStats && (
            <section className="uadmin-sec" data-testid="make-stats">
              <h3 className="uadmin-h">Make-проекты</h3>
              {makeStats.disk && <p className={makeStats.disk.alert ? 'uusage-note uusage-disk uusage-disk--alert' : 'uusage-note uusage-disk'} role={makeStats.disk.alert ? 'alert' : undefined} data-testid="admin-disk">{makeStats.disk.alert ? '⚠ ' : ''}Диск с данными: свободно {mb(makeStats.disk.freeBytes)} из {mb(makeStats.disk.totalBytes)}{makeStats.disk.alert ? ' — меньше 10 ГБ, релизы упрутся в проверку места; очистите docker/логи' : ''}</p>}
              <p className="uusage-note">Проектов: {makeStats.projects} · занято {mb(makeStats.bytes)} (файлы {mb(makeStats.filesBytes)}, снимки {mb(makeStats.snapshotsBytes)}, PNG стори {mb(makeStats.shotsBytes)}) · опубликовано {makeStats.published} · read-only ссылок {makeStats.shared} · просмотров публикаций {makeStats.views} · квота на проект {mb(makeStats.limitBytes)} · на пользователя {mb(makeStats.userLimitBytes)}</p>
              {makeStats.byUser.length > 0 && (
                <table className="utable"><thead><tr><th>Пользователь</th><th>Проектов</th><th>Занято</th><th>Опубликовано</th><th>Просмотров</th></tr></thead><tbody>
                  {makeStats.byUser.map((u) => { const share = makeStats.userLimitBytes ? u.bytes / makeStats.userLimitBytes : 0; return <tr key={u.user} className={share >= 0.8 ? 'uadmin-warn' : undefined} data-testid={share >= 0.8 ? 'make-user-quota-warn' : undefined}><td>{u.user}</td><td>{u.projects}</td><td>{mb(u.bytes)}{share >= 0.8 ? ` ⚠ ${Math.round(share * 100)}% квоты` : ''}</td><td>{u.published}</td><td>{u.views}</td></tr> })}
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
                      {onResetCode && <Button size="sm" onClick={() => void onResetCode(cur.name).then((r) => { if (r) setResetInfo({ name: cur.name, ...r }) })} title="Одноразовый код на 24 часа: пользователь вводит его на экране входа вместо пароля">Код сброса</Button>}
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

              {onSetLlmLimit && (
                <p className="uusage-note uadmin-limit" data-testid="admin-llm-limit">
                  Последний вход: {cur.lastLogin ? new Date(cur.lastLogin).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'не было'} · Лимит LLM в месяц, $: <input className="login-input uadmin-limit-input" type="number" min={0} step={1} aria-label="Лимит LLM в месяц, USD" placeholder={cur.llmLimitUsd === null || cur.llmLimitUsd === undefined ? 'без лимита' : String(cur.llmLimitUsd)} value={limitDraft} onChange={(e) => setLimitDraft(e.target.value)} />
                  <Button size="sm" onClick={() => { onSetLlmLimit(cur.name, limitDraft.trim() === '' ? null : Number(limitDraft)); setLimitDraft('') }}>Сохранить</Button>
                </p>
              )}
              {resetInfo && resetInfo.name === cur.name && (
                <p className="uusage-note" role="status" data-testid="admin-reset-code">Код сброса для <b>{cur.name}</b>: <code>{resetInfo.code}</code> — действует до {new Date(resetInfo.expiresAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}; передайте лично, повторно не показывается.</p>
              )}
              {sessionsClient && <AdminSessions client={sessionsClient} user={cur.name} />}
              <div className="useg" role="tablist" aria-label="Статистика пользователя">
                <button type="button" role="tab" aria-selected={tab === 'access'} className={tab === 'access' ? 'useg-item on' : 'useg-item'} onClick={() => setTab('access')}>Доступ к моделям</button>
                {isAdmin && <button type="button" role="tab" aria-selected={tab === 'machines'} className={tab === 'machines' ? 'useg-item on' : 'useg-item'} onClick={() => setTab('machines')}>Машины пользователя</button>}
                <button type="button" role="tab" aria-selected={tab === 'usage'} className={tab === 'usage' ? 'useg-item on' : 'useg-item'} onClick={() => setTab('usage')}>Использование моделей</button>
                <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'useg-item on' : 'useg-item'} onClick={() => setTab('history')}>История</button>
                {onLoadSecurity && <button type="button" role="tab" aria-selected={tab === 'security'} className={tab === 'security' ? 'useg-item on' : 'useg-item'} onClick={() => { setTab('security'); onLoadSecurity() }}>Безопасность</button>}
              </div>

              {isAdmin && tab === 'machines' && <section className="uadmin-sec">
                <h3 className="uadmin-h">Машины ({cur.agents.length})</h3>
                {cur.agents.length === 0 && <EmptyState compact icon="💻" title="Машин нет" description="Появятся, когда пользователь установит агента командой из меню «Машины»." />}
                {cur.agents.map((a) => (
                  <p key={a.id} className="uagent">
                    <span className={`exectarget-dot ${a.online ? 'remote' : 'server'}`} aria-hidden />
                    {a.name} — {a.online ? 'в сети' : 'офлайн'}{a.version ? ` · v${a.version}` : ''}
                  </p>
                ))}
                {latestAgentVersion && onUpdateMachine && <AgentFleetUpdate users={users} latestVersion={latestAgentVersion} onUpdate={onUpdateMachine} onRefresh={onRetry} />}
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

              {tab === 'security' && <section className="uadmin-sec" data-testid="admin-security">
                <h3 className="uadmin-h">Журнал безопасности</h3>
                {security === null || security === undefined ? <p className="fsub">Загрузка…</p> : security.length === 0 ? <EmptyState compact icon="🛡" title="Событий пока нет" description="Входы, выходы, неудачные попытки и смена пароля появятся здесь." /> : (
                  <table className="admin-security">
                    <thead><tr><th>Когда</th><th>Событие</th><th>IP</th><th>Устройство</th><th>Детали</th></tr></thead>
                    <tbody>
                      {security.map((e) => (
                        <tr key={e.id} className={/failed|locked|blocked/.test(e.type) ? 'admin-security--bad' : undefined}>
                          <td>{new Date(e.at).toLocaleString('ru-RU')}</td>
                          <td>{SECURITY_LABEL[e.type] ?? e.type}</td>
                          <td>{e.ip}</td>
                          <td title={e.userAgent}>{e.userAgent.slice(0, 40)}</td>
                          <td>{e.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

          {isAdmin && onReviewProjectType && (
            <section className="uadmin-sec" data-testid="project-types-queue-section">
              <h3 className="uadmin-h">Типы проектов</h3>
              <ProjectTypesAdmin pending={pendingProjectTypes} onReview={onReviewProjectType} />
            </section>
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
              {modelPrices.map((price) => <tr key={price.provider + price.model}><td>{price.provider} / {price.model}</td><td>{price.inputPerMillion}</td><td>{price.cachedInputPerMillion}</td><td>{price.cacheWritePerMillion}</td><td>{price.outputPerMillion}</td><td><a href={price.sourceUrl} target="_blank" rel="noreferrer">источник</a> · {formatDate(price.effectiveAt)}</td><td><Button size="sm" onClick={() => { setEditingPrice(price.provider + price.model); setPriceDraft({ provider: price.provider, model: price.model, inputPerMillion: price.inputPerMillion, cachedInputPerMillion: price.cachedInputPerMillion, cacheWritePerMillion: price.cacheWritePerMillion, outputPerMillion: price.outputPerMillion, sourceUrl: price.sourceUrl, effectiveAt: price.effectiveAt }) }}>Править</Button><Button variant="danger" size="sm" onClick={() => onDeleteModelPrice(price.provider, price.model)}>Удалить</Button></td></tr>)}
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
