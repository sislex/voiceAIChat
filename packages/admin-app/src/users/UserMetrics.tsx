// Полоса метрик над списком: люди, активность, машины, деньги.

import { MetricGrid } from '@voicechat/ui-kit'
import { formatUsd } from '@voicechat/profile-app'
import type { UsersMetrics } from './usersModel'

export interface UserMetricsProps {
  metrics: UsersMetrics
  periodLabel: string
}

export function UserMetrics({ metrics, periodLabel }: UserMetricsProps): JSX.Element {
  return (
    <MetricGrid
      columns={4}
      ariaLabel="Сводка"
      className="ua-metrics"
      testId="users-metrics"
      items={[
        {
          label: 'Всего пользователей',
          value: metrics.total,
          ...(metrics.createdThisMonth > 0 ? { hint: `+${metrics.createdThisMonth} за месяц` } : {})
        },
        {
          label: 'Активны сейчас',
          value: metrics.activeNow,
          // Ноль без пояснения читается как поломка метрики: объясняем, что
          // считается активностью и за какое окно.
          hint: metrics.activeNow > 0 ? 'по живым сессиям' : 'никто не работал последние 5 минут',
          tone: metrics.activeNow > 0 ? 'positive' : 'neutral'
        },
        {
          label: 'Машины онлайн',
          value: `${metrics.machinesOnline} / ${metrics.machinesTotal}`,
          hint: metrics.machinesTotal > 0 ? `${Math.round((metrics.machinesOnline / metrics.machinesTotal) * 100)}% парка` : 'машин нет'
        },
        {
          label: `Расход · ${periodLabel}`,
          value: formatUsd(metrics.spendUsd, metrics.spendIncomplete && metrics.spendUsd === 0),
          // Процент показывается только по сумме личных лимитов: общего бюджета
          // в системе нет, и брать его неоткуда.
          ...(metrics.limitShare === null
            ? (metrics.spendIncomplete ? { hint: 'часть ответов без тарифа' } : {})
            : { hint: `${Math.round(metrics.limitShare * 100)}% лимитов (${metrics.limitedUsers})` }),
          tone: metrics.limitShare !== null && metrics.limitShare >= 0.8 ? 'warning' : 'neutral'
        }
      ]}
    />
  )
}
