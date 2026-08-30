// Страница «Мой аккаунт»: та же карточка человека, что видит администратор, но
// про себя и без административных кнопок.
//
// Данные берутся личными роутами (`/api/me/*`, `/api/agents`): весь префикс
// `/api/admin/` закрыт привилегией `users:manage`, и не-админ туда не попадёт.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, ErrorState, Skeleton } from '@voicechat/ui-kit'
import {
  ProfilePanel,
  READ_ONLY,
  type ProfilePeriod,
  type ProfileProvider,
  type ProfileSecurityEvent,
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
    machines: profile.agents.map((agent) => ({
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

export function AccountPage({ api, tab, onChangeTab, onClose, onOpenSessions, onExportCsv, now = Date.now() }: AccountPageProps): JSX.Element {
  const [profile, setProfile] = useState<ProfileUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<ProfileUsage | null>(null)
  const [period, setPeriod] = useState<ProfilePeriod>('month')
  const [denied, setDenied] = useState<Array<{ provider: string; modelId: string }>>([])
  const [events, setEvents] = useState<ProfileSecurityEvent[] | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [me, access] = await Promise.all([api['me:profile'](), api['llm:access']()])
      setProfile(toProfileUser(me))
      setDenied(access.map((entry) => ({ provider: entry.provider, modelId: entry.modelId })))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  // Расход грузится под выбранный период, журнал — только когда он нужен: пока
  // человек смотрит обзор, тянуть двести событий незачем.
  useEffect(() => {
    const range = periodRange(period, now)
    let cancelled = false
    void api['usage:report']({ unit: 'day', ...range })
      .then((report) => { if (!cancelled) setUsage(toProfileUsage(report)) })
      .catch(() => { if (!cancelled) setUsage(null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, period])

  useEffect(() => {
    if (tab !== 'history' && tab !== 'overview') return
    if (events !== null) return
    let cancelled = false
    void api['me:security']({ limit: 200 })
      .then((list) => { if (!cancelled) setEvents(toProfileEvents(list)) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [api, tab, events])

  const capabilities = useMemo(() => READ_ONLY, [])

  return (
    <section className="admin-page" aria-label="Мой аккаунт" data-testid="account-page">
      <header className="admin-head">
        <h2>Мой аккаунт</h2>
        <span className="uadmin-actions">
          {onOpenSessions && <Button size="sm" onClick={onOpenSessions}>Сессии и устройства</Button>}
          <Button size="sm" onClick={onClose}>Закрыть</Button>
        </span>
      </header>
      {error && <ErrorState message="Не удалось загрузить профиль" detail={error} onRetry={() => void load()} />}
      {!profile && !error && <Skeleton variant="list" count={3} height={64} lines={2} testId="account-skeleton" />}
      {profile && (
        <ProfilePanel
          user={profile}
          capabilities={capabilities}
          providers={PROVIDERS}
          denied={denied}
          usage={usage}
          period={period}
          events={events}
          latestAgentVersion={AGENT_VERSION}
          activeWindowMs={ACTIVE_WINDOW_MS}
          now={now}
          tab={tab}
          onChangeTab={onChangeTab}
          onSelectPeriod={setPeriod}
          onExportCsv={onExportCsv}
        />
      )}
    </section>
  )
}
