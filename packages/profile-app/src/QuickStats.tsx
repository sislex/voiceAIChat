// Четыре факта о человеке, которые нужны раньше вкладок: когда был, сколько
// моделей доступно, сколько машин в сети, сколько потрачено за месяц.

import { MetricGrid } from '@voicechat/ui-kit'
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
  // Счётчики приходят со списком людей, сам список машин — позже: «0 из 0» до
  // загрузки выглядел бы как «машин нет».
  const online = user.machinesOnline ?? user.machines.filter((machine) => machine.online).length
  const total = user.machinesTotal ?? user.machines.length
  return (
    <MetricGrid
      compact
      columns={4}
      ariaLabel="Быстрые факты о человеке"
      className="vcp-quick"
      testId="profile-quick-stats"
      items={[
        {
          label: 'Последняя активность',
          value: formatAgo(user.lastSeenAt, now),
          ...(user.liveSessions ? { hint: `${user.liveSessions} живых сессий` } : {})
        },
        { label: 'Доступ', value: `${access.allowed} из ${access.total} моделей` },
        { label: 'Машины', value: `${online} из ${total} онлайн` },
        {
          label: 'Расход за месяц',
          value: usage ? formatUsd(usage.spendUsd, usage.spendIncomplete) : '—',
          ...(budget === null
            ? (user.llmLimitUsd == null ? { hint: 'лимит не задан' } : {})
            : { hint: `${Math.round(budget * 100)}% лимита` }),
          tone: budget !== null && budget >= 0.8 ? 'warning' : 'neutral'
        }
      ]}
    />
  )
}
