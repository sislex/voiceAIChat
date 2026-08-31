// Страница «Пользователи»: шапка, метрики, список слева и карточка человека справа.
//
// Карточку рисует общий модуль @voicechat/profile-app — тот же, что показывает
// человеку его собственную страницу. Две отдельные вёрстки одного и того же
// разошлись бы в мелочах, а расхождение в том, «что видно про человека»,
// заметить труднее всего.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, EmptyState } from '@voicechat/ui-kit'
import {
  FULL_ACCESS,
  ProfilePanel,
  READ_ONLY,
  securityLabel,
  type ProfileAccessDenial,
  type ProfileProvider,
  type ProfileSecurityEvent,
  type ProfilePeriod,
  type ProfileTab,
  type ProfileUsage,
  type ProfileUser
} from '@voicechat/profile-app'
import type { AdminUserInfo, SecurityEvent, UsageReport, UserUsageSummary } from '@shared/admin'
import { monthStart, spendUsd } from '@shared/admin'
import { CLAUDE_MODELS, CODEX_MODELS } from '@shared/types'
import type { UserRole } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'
import type { LoadStatus } from '../loadState'
import { UsersList } from './UsersList'
import { UserMetrics } from './UserMetrics'
import { CreateUserDialog } from './CreateUserDialog'
import { DEFAULT_FILTER, usersMetrics, type UsersFilter } from './usersModel'
import type { AdminRoute } from '../routes'

const PROVIDERS: ProfileProvider[] = [
  { id: 'claude', label: 'Anthropic Claude', models: CLAUDE_MODELS.map((model) => ({ id: model.id, label: model.label })) },
  { id: 'codex', label: 'OpenAI Codex', models: CODEX_MODELS.map((model) => ({ id: model.id, label: model.label })) }
]

/** Карточка человека из админских данных: те же поля, что отдаёт `/api/me/profile`. */
export function toProfileUser(user: AdminUserInfo): ProfileUser {
  return {
    name: user.name,
    role: user.role,
    blocked: user.blocked,
    createdAt: user.createdAt,
    email: user.email ?? null,
    lastLogin: user.lastLogin ?? null,
    lastSeenAt: user.lastSeenAt ?? null,
    liveSessions: user.liveSessions ?? 0,
    llmLimitUsd: user.llmLimitUsd ?? null,
    conversationCount: user.conversationCount,
    ...(user.mustChangePassword ? { mustChangePassword: true } : {}),
    machines: user.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      online: agent.online,
      ...(agent.version ? { version: agent.version } : {}),
      ...(agent.telemetry?.os.platform ? { platform: agent.telemetry.os.platform } : {}),
      ...(agent.telemetry?.os.release ? { osRelease: agent.telemetry.os.release } : {}),
      lastSeen: agent.lastSeen ?? null
    }))
  }
}

export function toProfileUsage(report: UsageReport): ProfileUsage {
  return {
    spendUsd: spendUsd(report.totals),
    ...(report.totals.costIncomplete ? { spendIncomplete: true } : {}),
    inputTokens: report.totals.inputTokens,
    outputTokens: report.totals.outputTokens,
    cacheReadTokens: report.totals.cacheReadTokens,
    messages: report.totals.messages,
    ...(report.totals.interrupted ? { interrupted: report.totals.interrupted } : {}),
    byModel: report.byModel.map((item) => ({
      model: item.model,
      spendUsd: spendUsd(item),
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      ...(item.costIncomplete ? { incomplete: true } : {})
    })),
    byBucket: report.byBucket.map((item) => ({ bucket: item.bucket, spendUsd: spendUsd(item) }))
  }
}

export function toProfileEvents(events: readonly SecurityEvent[] | null | undefined): ProfileSecurityEvent[] | null {
  if (!events) return null
  return events.map((event) => ({
    id: event.id,
    at: event.at,
    type: event.type,
    label: securityLabel(event.type),
    ip: event.ip,
    userAgent: event.userAgent,
    details: event.details
  }))
}

export interface UsersPageProps {
  users: AdminUserInfo[]
  usageSummary: readonly UserUsageSummary[]
  selected: string | null
  tab: ProfileTab
  period?: ProfilePeriod
  onSelectPeriod?: (period: ProfilePeriod) => void
  usage: UsageReport | null
  /** Расход выбранного человека ещё грузится — карточка покажет скелетон. */
  usageLoading?: boolean
  security?: SecurityEvent[] | null
  llmAccess: readonly UserLlmAccess[]
  currentUserName: string
  isAdmin: boolean
  status?: LoadStatus
  error?: string | null
  /** Ошибка загрузки данных выбранной вкладки — видна внутри карточки. */
  tabError?: string | null
  onRetryTab?: () => void
  latestAgentVersion?: string
  now?: number
  /** Слот хоста: список сессий выбранного человека. */
  sessionsSlot?: React.ReactNode
  /** Слот хоста под журналом: переписка человека — это администрирование. */
  historySlot?: React.ReactNode
  invitesSlot?: React.ReactNode
  onNavigate: (route: AdminRoute) => void
  onSelect: (name: string) => void
  onRetry?: () => void
  onCreate: (name: string, password: string, role: UserRole, mustChangePassword?: boolean) => void
  onUpdateRole?: (name: string, role: UserRole) => void
  onSetBlocked: (name: string, blocked: boolean, reason?: string) => void
  onDelete: (name: string) => void
  onSaveLlmAccess?: (access: UserLlmAccess[]) => void
  onUpdateMachine?: (machineId: string) => void
  onResetCode?: (name: string) => void
  onExportCsv?: (filename: string, csv: string) => void
}

export function UsersPage({
  users,
  usageSummary,
  selected,
  tab,
  period = 'month',
  onSelectPeriod,
  usage,
  usageLoading = false,
  security,
  llmAccess,
  currentUserName,
  isAdmin,
  status = 'ready',
  error = null,
  tabError = null,
  onRetryTab,
  latestAgentVersion,
  now = Date.now(),
  sessionsSlot,
  historySlot,
  invitesSlot,
  onNavigate,
  onSelect,
  onRetry,
  onCreate,
  onUpdateRole,
  onSetBlocked,
  onDelete,
  onSaveLlmAccess,
  onUpdateMachine,
  onResetCode,
  onExportCsv
}: UsersPageProps): JSX.Element {
  const [filter, setFilter] = useState<UsersFilter>(DEFAULT_FILTER)
  const [creating, setCreating] = useState(false)
  // Выбор человека с клавиатуры оставлял фокус в списке: следующий Tab уходил к
  // соседней строке, а не в карточку, которую человек только что открыл.
  const detailRef = useRef<HTMLDivElement>(null)
  const keyboardPick = useRef(false)
  useEffect(() => {
    if (!keyboardPick.current || !selected) return
    keyboardPick.current = false
    detailRef.current?.focus()
  }, [selected])
  const metrics = useMemo(() => usersMetrics(users, usageSummary, now, monthStart(now)), [users, usageSummary, now])
  const current = users.find((user) => user.name === selected) ?? null
  // Себя и встроенного admin блокировать и удалять нельзя: первое лишает доступа
  // самого администратора, второе оставляет установку без владельца.
  const manageable = current !== null && current.name !== 'admin' && current.name !== currentUserName
  const capabilities = !isAdmin
    ? READ_ONLY
    : { ...FULL_ACCESS, canBlock: manageable, canDelete: manageable, canChangeRole: manageable, canIssueResetCode: manageable && Boolean(onResetCode) }

  return (
    <div className="ua" data-testid="users-page">
      <header className="ua-top">
        <div>
          <p className="ua-top__eyebrow">Администрирование</p>
          <h1>Пользователи</h1>
        </div>
        <div className="ua-top__actions">
          <Button size="sm" variant="ghost" onClick={() => onNavigate({ page: 'prices' })}>Цены моделей</Button>
          <Button size="sm" variant="ghost" onClick={() => onNavigate({ page: 'engines' })}>Движки</Button>
          <Button size="sm" variant="ghost" onClick={() => onNavigate({ page: 'system' })}>Система</Button>
          {isAdmin && <Button size="sm" variant="primary" onClick={() => setCreating(true)}>＋ Добавить</Button>}
        </div>
      </header>

      <UserMetrics metrics={metrics} periodLabel="месяц" />

      <div className="ua-grid">
        <UsersList
          users={users}
          usageSummary={usageSummary}
          selected={selected}
          filter={filter}
          onFilter={setFilter}
          onSelect={(name, viaKeyboard) => { keyboardPick.current = Boolean(viaKeyboard); onSelect(name) }}
          status={status}
          error={error}
          {...(onRetry ? { onRetry } : {})}
          now={now}
        />

        <div className="ua-detail" data-testid="user-detail" ref={detailRef} tabIndex={-1}>
          {current === null
            ? <EmptyState icon="👤" title="Выберите человека" description="Слева список: карточка покажет доступ к моделям, машины, расход и журнал." />
            : (
              <ProfilePanel
                key={current.name}
                user={toProfileUser(current)}
                capabilities={capabilities}
                providers={PROVIDERS}
                denied={llmAccess.map((entry) => ({ provider: entry.provider, modelId: entry.modelId }))}
                usage={usage ? toProfileUsage(usage) : null}
                usageLoading={usageLoading}
                error={tabError}
                {...(onRetryTab ? { onRetry: onRetryTab } : {})}
                period={period}
                {...(onSelectPeriod ? { onSelectPeriod } : {})}
                events={toProfileEvents(security)}
                tab={tab}
                {...(latestAgentVersion ? { latestAgentVersion } : {})}
                now={now}
                {...(sessionsSlot ? { sessionsSlot } : {})}
                {...(historySlot ? { historySlot } : {})}
                onChangeTab={(next) => onNavigate({ page: 'users', userName: current.name, tab: next })}
                {...(isAdmin && manageable && onUpdateRole ? { onChangeRole: (role: UserRole) => onUpdateRole(current.name, role) } : {})}
                {...(isAdmin && manageable ? { onSetBlocked: (blocked: boolean, reason: string) => onSetBlocked(current.name, blocked, reason) } : {})}
                {...(isAdmin && manageable ? { onDelete: () => onDelete(current.name) } : {})}
                {...(isAdmin && manageable && onResetCode ? { onIssueResetCode: () => onResetCode(current.name) } : {})}
                {...(isAdmin && onSaveLlmAccess ? { onSaveAccess: (denied: ProfileAccessDenial[]) => onSaveLlmAccess(denied.map((item) => ({ provider: item.provider as UserLlmAccess['provider'], modelId: item.modelId }))) } : {})}
                {...(isAdmin && onUpdateMachine ? { onUpdateMachine } : {})}
                {...(onExportCsv ? { onExportCsv } : {})}
              />
            )}
        </div>
      </div>

      {invitesSlot}
      {creating && <CreateUserDialog onCreate={onCreate} onClose={() => setCreating(false)} />}
    </div>
  )
}
