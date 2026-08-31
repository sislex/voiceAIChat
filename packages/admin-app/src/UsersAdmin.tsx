import { useEffect, useState, type ReactNode } from 'react'
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
  AdminMakeStats, AdminMachineStats, SecurityEvent, InviteInfo, SignupConfig } from '@shared/admin'
import { monthStart } from '@shared/admin'
import type { Conversation, Message } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import { AgentFleetUpdate } from './AgentFleetUpdate'
import type { SessionsClient } from '@voicechat/sessions-app'
import { AdminSessions } from './AdminSessions'
import type { RoleCommandPolicies } from '@shared/commandPolicy'
import { Button, Dialog } from '@voicechat/ui-kit'
import type { LoadStatus } from './loadState'
import type { ProfileTab } from '@voicechat/profile-app'
import type { AdminRoute } from './routes'
import { UsersPage } from './users/UsersPage'
import { InvitesPanel } from './users/InvitesPanel'
import { EnginesPage } from './pages/EnginesPage'
import { ModelPricesPage } from './pages/ModelPricesPage'
import { ProjectTypesPage } from './pages/ProjectTypesPage'
import { SystemPage } from './pages/SystemPage'

/**
 * Рамка раздела. На странице свой заголовок рисует сама страница — у списка
 * людей он с надзаголовком и кнопками, и второй такой же в шапке рамки читался
 * как повтор.
 */
function AdminFrame({ variant, title, showTitle, onClose, children }: { variant: 'modal' | 'page'; title: string; showTitle: boolean; onClose: () => void; children: ReactNode }): JSX.Element {
  return variant === 'modal'
    ? <Dialog title={title} size="full" onClose={onClose} testId="users-overlay"><div className="admin-frame">{children}</div></Dialog>
    : (
      <section className="admin-page" aria-label={title} data-testid="users-overlay">
        <header className={showTitle ? 'admin-head' : 'admin-head admin-head--bare'}>
          {showTitle ? <h2>{title}</h2> : <span />}
          <Button onClick={onClose}>Закрыть</Button>
        </header>
        {children}
      </section>
    )
}

export interface UsersAdminProps {
  variant?: 'modal' | 'page'
  /** Адрес раздела: страница и вкладка живут в нём, а не во внутреннем состоянии. */
  route?: AdminRoute | null
  onNavigate?: (route: AdminRoute) => void
  /** Сохранение файла делает хост: у модуля нет доступа к странице. */
  onExportCsv?: (filename: string, csv: string) => void
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
  /** Отчёт в полёте: пустой расход и незагруженный расход выглядят по-разному. */
  usageLoading?: boolean
  /** Ошибка загрузки данных вкладки: тост исчезает, а карточка остаётся пустой. */
  tabError?: string | null
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
  onSetBlocked: (name: string, blocked: boolean, reason?: string) => void
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
  onLoadSecurity?: (limit?: number) => void
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

const PAGE_TITLE: Record<AdminRoute['page'], string> = {
  users: 'Пользователи',
  engines: 'LLM-исполнители',
  prices: 'Стоимость моделей',
  projectTypes: 'Типы проектов',
  system: 'Система'
}

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
  usageLoading = false,
  tabError = null,
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
  route = null,
  onNavigate,
  onExportCsv,
  variant = 'modal', latestAgentVersion, onUpdateMachine }: UsersAdminProps): JSX.Element {
  const [limitDraft, setLimitDraft] = useState<string>('')
  const [resetInfo, setResetInfo] = useState<{ name: string; code: string; expiresAt: number } | null>(null)
  const [inner, setInner] = useState<AdminRoute>({ page: 'users' })
  const [period, setPeriod] = useState<'month' | '7d' | '30d' | 'all'>('month')
  const current = route ?? inner
  const page = current.page
  const tab: ProfileTab = current.page === 'users' ? (current.tab ?? 'overview') : 'overview'
  const selectedName = current.page === 'users' ? (current.userName ?? selected) : selected
  const navigate = (next: AdminRoute): void => {
    setInner(next)
    onNavigate?.(next)
  }

  // Данные вкладки грузятся при её открытии, а не все сразу при выборе человека:
  // журнал в двести событий не нужен тому, кто смотрит обзор, а расход — тому,
  // кто пришёл за машинами.
  /** Границы периода отчёта: месяц — с первого числа, остальное — окном назад. */
  const loadUsageFor = (next: 'month' | '7d' | '30d' | 'all'): void => {
    const to = Date.now()
    if (next === 'all') onLoadUsage('day')
    else if (next === 'month') onLoadUsage('day', monthStart(to), to)
    else onLoadUsage('day', to - (next === '7d' ? 7 : 30) * 86_400_000, to)
  }

  useEffect(() => {
    if (!selectedName) return
    if (tab === 'usage' || tab === 'overview') loadUsageFor(period)
    // Обзору хватает двадцати последних событий: лента показывает пять. Полный
    // журнал (двести) грузится только на своей вкладке.
    if (tab === 'history') onLoadSecurity?.(200)
    else if (tab === 'overview') onLoadSecurity?.(20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedName, tab, period])

  const currentUser = users.find((user) => user.name === selectedName) ?? null

  return (
    <AdminFrame variant={variant} title={PAGE_TITLE[page]} showTitle={page !== 'users'} onClose={onClose}>
      {page !== 'users' && (
        <p className="ua-back">
          <Button size="sm" variant="ghost" onClick={() => navigate({ page: 'users' })}>← К пользователям</Button>
        </p>
      )}

      {page === 'users' && (
        <>
          <UsersPage
            users={users}
            usageSummary={usageSummary}
            selected={selectedName}
            tab={tab}
            usage={usage}
            usageLoading={usageLoading}
            tabError={tabError}
            onRetryTab={() => { if (tab === 'history') onLoadSecurity?.(200); else loadUsageFor(period) }}
            security={security}
            llmAccess={llmAccess}
            currentUserName={currentUserName}
            isAdmin={isAdmin}
            status={status}
            error={error}
            {...(latestAgentVersion ? { latestAgentVersion } : {})}
            {...(onRetry ? { onRetry } : {})}
            {...(onExportCsv ? { onExportCsv } : {})}
            period={period}
            onSelectPeriod={(next) => setPeriod(next)}
            onNavigate={navigate}
            onSelect={(name) => { onSelect(name); navigate({ page: 'users', userName: name, tab }) }}
            onCreate={onCreate}
            onUpdateRole={onUpdateRole}
            onSetBlocked={onSetBlocked}
            onDelete={onDelete}
            onSaveLlmAccess={onSaveLlmAccess}
            {...(onResetCode ? { onResetCode: (name: string) => void onResetCode(name).then((result) => { if (result) setResetInfo({ name, ...result }) }) } : {})}
            {...(onUpdateMachine ? { onUpdateMachine: (id: string) => void onUpdateMachine(id) } : {})}
            {...(sessionsClient && currentUser ? { sessionsSlot: <AdminSessions client={sessionsClient} user={currentUser.name} /> } : {})}
            {...(currentUser ? {
              historySlot: (
                <section className="uadmin-sec" data-testid="user-history-section">
                  <h3 className="uadmin-h">Разговоры ({conversations.length})</h3>
                  {conversations.map((conversation) => (
                    <button key={conversation.id} className={conversation.id === conversationId ? 'cc-item on' : 'cc-item'} onClick={() => onOpenConversation(conversation.id)}>
                      <span className="cc-name">{conversation.title}</span>
                      <span className="cc-sub">{conversation.messageCount} сообщений</span>
                    </button>
                  ))}
                  {conversationId && (
                    <div className="uhistory" data-testid="user-history">
                      {messages.map((message) => (
                        <p key={message.id} className={message.role === 'ai' ? 'umsg ai' : 'umsg'}>
                          <span className="umsg-role">{message.role === 'ai' ? 'Ассистент' : message.role}</span>
                          <span className="umsg-text">{message.text}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </section>
              )
            } : {})}
            {...(isAdmin ? {
              invitesSlot: (
                <>
                  {currentUser && isAdmin && onSetLlmLimit && (
                    <p className="uusage-note uadmin-limit" data-testid="admin-llm-limit">
                      Лимит LLM для <b>{currentUser.name}</b> в месяц, $:
                      <input className="login-input uadmin-limit-input" type="number" min={0} step={1} aria-label="Лимит LLM в месяц, USD" placeholder={currentUser.llmLimitUsd == null ? 'без лимита' : String(currentUser.llmLimitUsd)} value={limitDraft} onChange={(event) => setLimitDraft(event.target.value)} />
                      <Button size="sm" onClick={() => { onSetLlmLimit(currentUser.name, limitDraft.trim() === '' ? null : Number(limitDraft)); setLimitDraft('') }}>Сохранить</Button>
                    </p>
                  )}
                  {resetInfo && currentUser && resetInfo.name === currentUser.name && (
                    <p className="uusage-note" role="status" data-testid="admin-reset-code">
                      Код сброса для <b>{currentUser.name}</b>: <code>{resetInfo.code}</code> — действует до {new Date(resetInfo.expiresAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}; передайте лично, повторно не показывается.
                    </p>
                  )}
                  <InvitesPanel
                    invites={invites}
                    {...(onLoadInvites ? { onLoadInvites } : {})}
                    {...(onCreateInvite ? { onCreateInvite } : {})}
                    {...(onDeleteInvite ? { onDeleteInvite } : {})}
                    inviteBaseUrl={inviteBaseUrl}
                    signup={signup}
                    {...(onLoadSignup ? { onLoadSignup } : {})}
                    {...(onSetSignup ? { onSetSignup } : {})}
                  />
                </>
              )
            } : {})}
          />
        </>
      )}

      {page === 'engines' && isAdmin && (
        <EnginesPage
          engines={engines}
          enginesStatus={enginesStatus}
          enginesError={enginesError}
          engineHealth={engineHealth}
          {...(onRetryEngines ? { onRetryEngines } : {})}
          onCreateEngine={onCreateEngine}
          onUpdateEngine={onUpdateEngine}
          onDeleteEngine={onDeleteEngine}
          onCheckEngineHealth={onCheckEngineHealth}
        />
      )}

      {page === 'prices' && isAdmin && (
        <ModelPricesPage modelPrices={modelPrices} onSaveModelPrice={onSaveModelPrice} onDeleteModelPrice={onDeleteModelPrice} />
      )}

      {page === 'projectTypes' && isAdmin && onReviewProjectType && (
        <ProjectTypesPage pendingProjectTypes={pendingProjectTypes} onReviewProjectType={onReviewProjectType} />
      )}

      {page === 'system' && isAdmin && (
        <SystemPage
          fleetSlot={isAdmin && latestAgentVersion && onUpdateMachine
            ? <AgentFleetUpdate users={users} latestVersion={latestAgentVersion} onUpdate={onUpdateMachine} onRefresh={onRetry} />
            : null}
          machineStats={machineStats}
          makeStats={makeStats}
          roleCommandPolicies={roleCommandPolicies}
          {...(onSaveRoleCommandPolicies ? { onSaveRoleCommandPolicies } : {})}
        />
      )}
    </AdminFrame>
  )
}

// Пустые значения по умолчанию — модульные константы, а не литералы в параметрах.
// Литерал создаёт новый массив на каждый рендер и зацикливает эффекты, которые
// держат его в зависимостях: так однажды подвисал весь ui-набор тестов.
const NO_LLM_ACCESS: UserLlmAccess[] = []
const NO_USAGE_SUMMARY: UserUsageSummary[] = []
