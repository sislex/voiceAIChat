// Четыре факта о человеке, которые нужны раньше вкладок: когда был, сколько
// моделей доступно, сколько машин в сети, сколько потрачено за месяц.

import { StatCard } from '@voicechat/ui-kit'
import type { ProfileUsage, ProfileUser } from './contracts'
import { formatAgo } from './format'
import { formatUsd } from './model'

export interface QuickStatsProps {
  user: ProfileUser
  /** Сводка доступа: сколько моделей открыто из скольких. */
  access: { allowed: number; total: number }
  usage: ProfileUsage | null
  /** Доля израсходованного лимита; null — лимита нет и процента быть не может. */
  budget: number | null
  now: number
}

export function QuickStats({ user, access, usage, budget, now }: QuickStatsProps): JSX.Element {
  const online = user.machines.filter((machine) => machine.online).length
  return (
    <div className="vcp-quick" data-testid="profile-quick-stats">
      <StatCard compact label="Последняя активность" value={formatAgo(user.lastSeenAt, now)} hint={user.liveSessions ? `${user.liveSessions} живых сессий` : undefined} />
      <StatCard compact label="Доступ" value={`${access.allowed} из ${access.total} моделей`} />
      <StatCard compact label="Машины" value={`${online} из ${user.machines.length} онлайн`} />
      <StatCard
        compact
        label="Расход за месяц"
        value={usage ? formatUsd(usage.spendUsd, usage.spendIncomplete) : '—'}
        hint={budget === null ? (user.llmLimitUsd == null ? 'лимит не задан' : undefined) : `${Math.round(budget * 100)}% лимита`}
        tone={budget !== null && budget >= 0.8 ? 'warning' : 'neutral'}
      />
    </div>
  )
}
