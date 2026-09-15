// Страница «Мой аккаунт»: та же карточка человека, что видит администратор, но
// про себя и без административных кнопок.
//
// Данные берутся личными роутами (`/api/me/*`, `/api/agents`): весь префикс
// `/api/admin/` закрыт привилегией `users:manage`, и не-админ туда не попадёт.

import { useEffect, useMemo, useState } from 'react'
import { readResources } from '../clients/readResources'
import { isObsoleteRead } from '../lib/readCache'
import { Button, ErrorState, Skeleton, RefreshIndicator } from '@voicechat/ui-kit'
import {
  ProfilePanel,
  READ_ONLY,
  type ProfilePeriod,
  type ProfileProvider,
  type ProfileSecurityEvent,
  type SecurityGroup,
  type ProfileTab,
  type ProfileUsage,
  type ProfileUser
} from '@voicechat/profile-app'
import { securityLabel } from '@voicechat/profile-app'
import { AGENT_VERSION, CLAUDE_MODELS, CODEX_MODELS, monthStart, spendUsd, ACTIVE_WINDOW_MS } from '@shared/index'
import type { RendererApi } from '@shared/ipc'
import type { UsageReport, UserProfileInfo, SecurityEvent } from '@shared/admin'

export interface AccountPageProps {
  api: RendererApi
  tab: ProfileTab
  onChangeTab: (tab: ProfileTab) => void
  onClose: () => void
  /** Открыть окно «Сессии и устройства» — оно уже есть в приложении. */
  onOpenSessions?: () => void
  /** Скачивание файла делает хост: у модуля профиля доступа к странице нет. */
  onExportCsv: (filename: string, csv: string) => void
  now?: number
}

const PROVIDERS: ProfileProvider[] = [
  { id: 'claude', label: 'Anthropic Claude', models: CLAUDE_MODELS.map((model) => ({ id: model.id, label: model.label })) },
  { id: 'codex', label: 'OpenAI Codex', models: CODEX_MODELS.map((model) => ({ id: model.id, label: model.label })) }
]

/** Границы периода: месяц считается от первого числа, остальное — окном назад. */
export function periodRange(period: ProfilePeriod, now: number): { from?: number; to?: number } {
  if (period === 'all') return {}
  if (period === 'month') return { from: monthStart(now), to: now }
  return { from: now - (period === '7d' ? 7 : 30) * 86_400_000, to: now }
}

/** Отчёт сервера → данные карточки. Здесь же выбирается «большая из двух оценок». */
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

/** Профиль сервера → пользователь карточки; ОС берётся из телеметрии агента. */
export function toProfileUser(profile: UserProfileInfo): ProfileUser {
  return {
    name: profile.name,
    role: profile.role,
    blocked: profile.blocked,
    createdAt: profile.createdAt,
    email: profile.email ?? null,
    lastLogin: profile.lastLogin ?? null,
    lastSeenAt: profile.lastSeenAt ?? null,
    liveSessions: profile.liveSessions ?? 0,
    llmLimitUsd: profile.llmLimitUsd ?? null,
    conversationCount: profile.conversationCount,
    ...(profile.mustChangePassword ? { mustChangePassword: true } : {}),
    ...(profile.machinesTotal !== undefined ? { machinesTotal: profile.machinesTotal } : {}),
    ...(profile.machinesOnline !== undefined ? { machinesOnline: profile.machinesOnline } : {}),
    machines: (profile.agents ?? []).map((agent) => ({
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

export function toProfileEvents(events: SecurityEvent[]): ProfileSecurityEvent[] {
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

export function AccountPage({ api: sourceApi, tab, onChangeTab, onClose, onOpenSessions, onExportCsv, now = Date.now() }: AccountPageProps): JSX.Element {
  const reads = useMemo(() => readResources(sourceApi), [sourceApi])
  const api = reads.api
  const [clockTick, setClockTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setClockTick(value => value + 1), 30_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => reads.cache.onInvalidated(() => setClockTick(value => value + 1)), [reads])
  // Move report boundaries only on a freshness tick, never on ordinary renders.
  const referenceNow = useMemo(() => reads.periodNow(now), [reads, clockTick])
  const [profile, setProfile] = useState<ProfileUser | null>(() => {
    const cached = reads.peek('me:profile')
    return cached ? toProfileUser({ ...cached, ...(reads.peek('agents:list') ? { agents: reads.peek('agents:list') } : {}) }) : null
  })
  const [error, setError] = useState<string | null>(null)
  const [profileReload, setProfileReload] = useState(0)
  const [accessLoading, setAccessLoading] = useState(false)
  const [accessLoaded, setAccessLoaded] = useState(() => reads.fresh('llm:access'))
  const [accessError, setAccessError] = useState<string | null>(null)
  const [accessReload, setAccessReload] = useState(0)
  const [usageByPeriod, setUsageByPeriod] = useState<Partial<Record<ProfilePeriod, ProfileUsage>>>(() => {
    const report = reads.peek('usage:report', { unit: 'day', ...periodRange('month', referenceNow) })
    return report ? { month: toProfileUsage(report) } : {}
  })
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [usageReload, setUsageReload] = useState(0)
  const [period, setPeriod] = useState<ProfilePeriod>('month')
  const [denied, setDenied] = useState<Array<{ provider: string; modelId: string }>>(() => reads.peek('llm:access') ?? [])
  const [events, setEvents] = useState<ProfileSecurityEvent[] | null>(() => {
    const cached = reads.peek('me:security', { limit: 200, group: 'all' })
    return cached ? toProfileEvents(cached) : null
  })
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsLoaded, setEventsLoaded] = useState(() => reads.fresh('me:security', { limit: 200, group: 'all' }))
  const [eventsGroup, setEventsGroup] = useState<SecurityGroup | null>('all')
  const [securityGroup, setSecurityGroup] = useState<SecurityGroup>('all')
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [eventsReload, setEventsReload] = useState(0)
  const [machinesLoading, setMachinesLoading] = useState(false)
  const [machinesLoaded, setMachinesLoaded] = useState(() => reads.fresh('agents:list'))
  const [machinesError, setMachinesError] = useState<string | null>(null)
  const [machinesReload, setMachinesReload] = useState(0)
  const usage = usageByPeriod[period] ?? null

  useEffect(() => {
    let cancelled = false
    setError(null)
    void api['me:profile']().then(me => {
      if (cancelled) return
      const agents = reads.peek('agents:list') ?? me.agents
      setProfile(toProfileUser({ ...me, ...(agents ? { agents } : {}) }))
      if (agents !== undefined) setMachinesLoaded(true)
    }).catch(err => {
      if (!cancelled && !isObsoleteRead(err)) setError(err instanceof Error ? err.message : String(err))
    })
    return () => { cancelled = true }
  }, [api, profileReload, clockTick])

  // Access contributes one overview metric, but it must not delay the profile
  // identity and navigation that make the page feel ready.
  useEffect(() => {
    if (tab !== 'overview' && tab !== 'access') return
    if (accessLoaded && reads.fresh('llm:access')) return
    let cancelled = false
    setAccessLoading(true)
    setAccessError(null)
    void api['llm:access']()
      .then((access) => {
        if (cancelled) return
        setDenied(access.map((entry) => ({ provider: entry.provider, modelId: entry.modelId })))
        setAccessLoading(false)
        setAccessLoaded(true)
      })
      .catch((err) => {
        if (cancelled || isObsoleteRead(err)) return
        setAccessError(err instanceof Error ? err.message : String(err))
        setAccessLoading(false)
      })
    return () => { cancelled = true }
  }, [api, tab, accessLoaded, accessReload, reads, clockTick])

  // Usage aggregation is relevant only to Overview and Usage. Other tabs avoid
  // scanning message metadata until the user asks for those figures.
  useEffect(() => {
    if (tab !== 'overview' && tab !== 'usage') return
    const range = periodRange(period, referenceNow)
    if (usageByPeriod[period] && reads.fresh('usage:report', { unit: 'day', ...range })) return
    let cancelled = false
    setUsageLoading(true)
    setUsageError(null)
    void api['usage:report']({ unit: 'day', ...range })
      .then((report) => {
        if (cancelled) return
        setUsageByPeriod((current) => ({ ...current, [period]: toProfileUsage(report) }))
        setUsageLoading(false)
      })
      .catch((err) => {
        if (cancelled || isObsoleteRead(err)) return
        setUsageError(err instanceof Error ? err.message : String(err))
        setUsageLoading(false)
      })
    return () => { cancelled = true }
  }, [api, period, referenceNow, tab, usageByPeriod, usageReload, reads, clockTick])

  useEffect(() => {
    if (tab !== 'history' && tab !== 'overview') return
    const requestedGroup: SecurityGroup = tab === 'overview' ? 'all' : securityGroup
    if (eventsLoaded && eventsGroup === requestedGroup && reads.fresh('me:security', { limit: 200, group: requestedGroup })) return
    let cancelled = false
    setEventsLoading(true)
    setEventsError(null)
    void api['me:security']({ limit: 200, group: requestedGroup })
      .then((list) => {
        if (cancelled) return
        setEvents(toProfileEvents(list))
        setEventsLoading(false)
        setEventsLoaded(true)
        setEventsGroup(requestedGroup)
      })
      .catch((err) => {
        if (cancelled || isObsoleteRead(err)) return
        setEventsError(err instanceof Error ? err.message : String(err))
        setEventsLoading(false)
      })
    return () => { cancelled = true }
  }, [api, tab, eventsGroup, eventsLoaded, eventsReload, securityGroup, reads, clockTick])

  // Full versions and telemetry are useful only after the Machines tab opens.
  useEffect(() => {
    if (tab !== 'machines' || !profile) return
    if (machinesLoaded && reads.fresh('agents:list')) return
    let cancelled = false
    setMachinesLoading(true)
    setMachinesError(null)
    void api['agents:list']()
      .then((agents) => {
        if (cancelled) return
        const withMachines = toProfileUser({
          name: profile.name,
          role: profile.role,
          blocked: profile.blocked,
          createdAt: profile.createdAt,
          conversationCount: profile.conversationCount,
          agents
        })
        setProfile((current) => current ? {
          ...current,
          machines: withMachines.machines,
          machinesTotal: agents.length,
          machinesOnline: agents.filter((agent) => agent.online).length
        } : current)
        setMachinesLoading(false)
        setMachinesLoaded(true)
      })
      .catch((err) => {
        if (cancelled || isObsoleteRead(err)) return
        setMachinesError(err instanceof Error ? err.message : String(err))
        setMachinesLoading(false)
      })
    return () => { cancelled = true }
  }, [api, tab, profile, machinesLoaded, machinesReload, reads, clockTick])

  const capabilities = useMemo(() => READ_ONLY, [])
  const requestedSecurityGroup: SecurityGroup = tab === 'overview' ? 'all' : securityGroup
  const showAccessLoading = (accessLoading && !accessLoaded) || ((tab === 'overview' || tab === 'access') && !accessLoaded && !accessError)
  const showUsageLoading = (usageLoading && !usage) || ((tab === 'overview' || tab === 'usage') && !usageByPeriod[period] && !usageError)
  const showEventsLoading = (eventsLoading && (!eventsLoaded || eventsGroup !== requestedSecurityGroup)) || ((tab === 'overview' || tab === 'history') && (!eventsLoaded || eventsGroup !== requestedSecurityGroup) && !eventsError)
  const showMachinesLoading = (machinesLoading && !machinesLoaded) || (tab === 'machines' && !machinesLoaded && !machinesError)

  return (
    <section className="admin-page account-page" aria-label="Мой аккаунт" data-testid="account-page">
      <header className="admin-head account-head">
        <div className="account-head__copy">
          <h1>Мой аккаунт</h1>
          <p>Профиль, доступ, устройства и использование моделей</p>
        </div>
        <span className="uadmin-actions">
          {onOpenSessions && <Button size="sm" onClick={onOpenSessions}>Сессии и устройства</Button>}
          <Button size="sm" onClick={onClose}>Закрыть</Button>
        </span>
      </header>
      {error && <ErrorState message="Не удалось загрузить профиль" detail={error} onRetry={() => setProfileReload((value) => value + 1)} />}
      {!profile && !error && <Skeleton variant="list" count={3} height={64} lines={2} testId="account-skeleton" />}
      {profile && (usageLoading && usage || accessLoading && accessLoaded || eventsLoading && eventsLoaded || machinesLoading && machinesLoaded) && <RefreshIndicator />}
      {profile && (
        <ProfilePanel
          user={profile}
          capabilities={capabilities}
          providers={PROVIDERS}
          denied={denied}
          usage={usage}
          usageLoading={showUsageLoading}
          accessLoading={showAccessLoading}
          machinesLoading={showMachinesLoading}
          eventsLoading={showEventsLoading}
          error={tab === 'access' ? accessError : tab === 'machines' ? machinesError : tab === 'usage' ? usageError : tab === 'history' ? eventsError : usageError ?? eventsError ?? accessError}
          period={period}
          events={events}
          securityGroup={securityGroup}
          onChangeSecurityGroup={(group) => {
            setSecurityGroup(group)
            const cached = reads.peek('me:security', { limit: 200, group })
            if (cached && reads.fresh('me:security', { limit: 200, group })) {
              setEvents(toProfileEvents(cached))
              setEventsGroup(group)
              setEventsLoaded(true)
              setEventsError(null)
            } else setEventsLoaded(false)
          }}
          latestAgentVersion={AGENT_VERSION}
          activeWindowMs={ACTIVE_WINDOW_MS}
          now={referenceNow}
          tab={tab}
          onChangeTab={onChangeTab}
          onSelectPeriod={setPeriod}
          onRetry={() => {
            if (tab === 'access') setAccessReload((value) => value + 1)
            else if (tab === 'machines') setMachinesReload((value) => value + 1)
            else if (tab === 'history') setEventsReload((value) => value + 1)
            else if (tab === 'usage') setUsageReload((value) => value + 1)
            else {
              if (accessError) setAccessReload((value) => value + 1)
              if (eventsError) setEventsReload((value) => value + 1)
              if (usageError) setUsageReload((value) => value + 1)
            }
          }}
          onExportCsv={onExportCsv}
        />
      )}
    </section>
  )
}
