// Полоса метрик над списком: люди, активность, машины, деньги.

import { MetricsRow, StatCard } from '@voicechat/ui-kit'
import { formatUsd } from '@voicechat/profile-app'
import type { UsersMetrics } from './usersModel'

export interface UserMetricsProps {
  metrics: UsersMetrics
  periodLabel: string
}

export function UserMetrics({ metrics, periodLabel }: UserMetricsProps): JSX.Element {
  return (
    <MetricsRow label="Сводка" className="ua-metrics" testId="users-metrics">
      <StatCard label="Всего пользователей" value={metrics.total} hint={metrics.createdThisMonth > 0 ? `+${metrics.createdThisMonth} за месяц` : undefined} />
      <StatCard
        label="Активны сейчас"
        value={metrics.activeNow}
        // Ноль без пояснения читается как поломка метрики: объясняем, что
        // считается активностью и за какое окно.
        hint={metrics.activeNow > 0 ? 'по живым сессиям' : 'никто не работал последние 5 минут'}
        tone={metrics.activeNow > 0 ? 'positive' : 'neutral'}
      />
      <StatCard
        label="Машины онлайн"
        value={`${metrics.machinesOnline} / ${metrics.machinesTotal}`}
        hint={metrics.machinesTotal > 0 ? `${Math.round((metrics.machinesOnline / metrics.machinesTotal) * 100)}% парка` : 'машин нет'}
      />
      <StatCard
        label={`Расход · ${periodLabel}`}
        value={formatUsd(metrics.spendUsd, metrics.spendIncomplete && metrics.spendUsd === 0)}
        /* Процент показывается только по сумме личных лимитов: общего бюджета в
           системе нет, и брать его неоткуда. */
        hint={metrics.limitShare === null ? (metrics.spendIncomplete ? 'часть ответов без тарифа' : undefined) : `${Math.round(metrics.limitShare * 100)}% лимитов (${metrics.limitedUsers})`}
        tone={metrics.limitShare !== null && metrics.limitShare >= 0.8 ? 'warning' : 'neutral'}
      />
    </MetricsRow>
  )
}
