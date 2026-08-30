// Вся арифметика карточки: доступ, расход, лента, CSV.
//
// Держим её отдельно от разметки, потому что именно здесь живут решения, которые
// нельзя проверить глазами: что показывать, когда лимита нет; чем «доступно
// 6 из 7» отличается от «провайдер выключен»; как выглядит журнал в CSV.

import type {
  ProfileAccessDenial,
  ProfileConversation,
  ProfileMachine,
  ProfileProvider,
  ProfileSecurityEvent,
  ProfileSpendPoint,
  ProfileUsage
} from './contracts'

/** Сводка доступа: сколько моделей разрешено и сколько закрыто. */
export interface AccessSummary {
  allowed: number
  denied: number
  byProvider: Array<{ provider: string; label: string; allowed: number; total: number; enabled: boolean }>
}

/** Закрыта ли модель: либо провайдер целиком, либо она сама. */
export function isModelDenied(denied: readonly ProfileAccessDenial[], provider: string, modelId: string): boolean {
  return denied.some((item) => item.provider === provider && (item.modelId === '*' || item.modelId === modelId))
}

/** Включён ли провайдер целиком. Выключение провайдера — запись с `modelId: '*'`. */
export function isProviderEnabled(denied: readonly ProfileAccessDenial[], provider: string): boolean {
  return !denied.some((item) => item.provider === provider && item.modelId === '*')
}

export function accessSummary(denied: readonly ProfileAccessDenial[], providers: readonly ProfileProvider[]): AccessSummary {
  const byProvider = providers.map((provider) => {
    const enabled = isProviderEnabled(denied, provider.id)
    const allowed = provider.models.filter((model) => !isModelDenied(denied, provider.id, model.id)).length
    return { provider: provider.id, label: provider.label, allowed, total: provider.models.length, enabled }
  })
  const allowed = byProvider.reduce((sum, item) => sum + item.allowed, 0)
  const total = providers.reduce((sum, provider) => sum + provider.models.length, 0)
  return { allowed, denied: total - allowed, byProvider }
}

/**
 * Переключение доступа. Разрешение модели снимает запрет и на неё саму, и на
 * провайдера целиком: иначе галочка ставится, а доступа всё равно нет — запрет
 * `'*'` перекрывает её, и человек не понимает, почему ничего не изменилось.
 */
export function toggleAccess(
  denied: readonly ProfileAccessDenial[],
  provider: string,
  modelId: string,
  allow: boolean,
  models: readonly string[] = []
): ProfileAccessDenial[] {
  if (modelId === '*') {
    const others = denied.filter((item) => item.provider !== provider)
    return allow ? others : [...others, { provider, modelId: '*' }]
  }
  const without = denied.filter((item) => !(item.provider === provider && item.modelId === modelId))
  if (!allow) return [...without, { provider, modelId }]
  const wasProviderOff = !isProviderEnabled(denied, provider)
  if (!wasProviderOff) return without
  // Провайдер был выключен целиком: снимаем общий запрет и явно закрываем все
  // модели, кроме разрешаемой, — набор прав остаётся тем же, каким его видел человек.
  const rest = models.filter((id) => id !== modelId).map((id) => ({ provider, modelId: id }))
  return [...without.filter((item) => item.provider !== provider), ...rest]
}

/** Разрешить или запретить всё сразу: кнопки «Разрешить всё» / «Запретить всё». */
export function setAllAccess(providers: readonly ProfileProvider[], allow: boolean): ProfileAccessDenial[] {
  return allow ? [] : providers.map((provider) => ({ provider: provider.id, modelId: '*' }))
}

/** Расход: показываем «—», когда часть ответов без цены и сумма нулевая. */
export function formatUsd(value: number, incomplete?: boolean): string {
  if (incomplete && value === 0) return '—'
  return `$${value.toFixed(value < 0.1 && value > 0 ? 4 : 2)}`
}

/** Крупные числа токенов: 8.4M, 128.4k, 940. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

/** Доли моделей в расходе — ширина полос на вкладке «Обзор». */
export function modelShares(usage: ProfileUsage): Array<{ model: string; spendUsd: number; share: number; incomplete?: boolean }> {
  const max = Math.max(...usage.byModel.map((item) => item.spendUsd), 0)
  return usage.byModel.map((item) => ({
    model: item.model,
    spendUsd: item.spendUsd,
    share: max > 0 ? item.spendUsd / max : 0,
    ...(item.incomplete ? { incomplete: true } : {})
  }))
}

/** Точки графика расхода в порядке периодов. */
export function spendPoints(usage: ProfileUsage): ProfileSpendPoint[] {
  return [...usage.byBucket].sort((a, b) => a.bucket.localeCompare(b.bucket))
}

/** Элемент ленты активности: событие безопасности или разговор. */
export interface ActivityItem {
  id: string
  at: number
  kind: 'security' | 'conversation'
  title: string
  detail: string
}

/**
 * Лента активности собирается из уже загруженного: журнала безопасности и
 * списка разговоров. Отдельного источника «активности» в системе нет, и заводить
 * его ради ленты было бы выдумыванием данных.
 */
export function activityFeed(
  events: readonly ProfileSecurityEvent[],
  conversations: readonly ProfileConversation[],
  limit = 20
): ActivityItem[] {
  const fromEvents: ActivityItem[] = events.map((event) => ({
    id: `event-${event.id}`,
    at: event.at,
    kind: 'security',
    title: event.label,
    detail: [event.details, event.ip].filter(Boolean).join(' · ')
  }))
  const fromChats: ActivityItem[] = conversations.map((chat) => ({
    id: `chat-${chat.id}`,
    at: chat.updatedAt,
    kind: 'conversation',
    title: chat.title || 'Без названия',
    detail: `${chat.messageCount} сообщений`
  }))
  return [...fromEvents, ...fromChats].sort((a, b) => b.at - a.at).slice(0, limit)
}

/** Состояние версии агента на машине. */
export type MachineVersionState = 'unknown' | 'current' | 'outdated'

export function machineVersionState(version: string | undefined, latest: string | undefined): MachineVersionState {
  if (!version || !latest) return 'unknown'
  return version === latest ? 'current' : 'outdated'
}

/** ОС машины строкой. Нет телеметрии — нет и строки: у офлайн-машины её взять негде. */
export function machineOs(machine: ProfileMachine): string | null {
  if (!machine.platform) return null
  const names: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
  const name = names[machine.platform] ?? machine.platform
  return machine.osRelease ? `${name} ${machine.osRelease}` : name
}

/** Экранирование поля CSV: кавычки удваиваются, поле берётся в кавычки. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Журнал безопасности в CSV — то, что человек уносит в таблицу или в тикет. */
export function securityEventsToCsv(events: readonly ProfileSecurityEvent[], formatDate: (at: number) => string): string {
  const header = ['Когда', 'Событие', 'IP', 'Устройство', 'Детали'].map(csvCell).join(',')
  const rows = events.map((event) => [formatDate(event.at), event.label, event.ip, event.userAgent, event.details].map(csvCell).join(','))
  return [header, ...rows].join('\n')
}

/** Сколько «активных сейчас» в списке — метрика над таблицей. */
export function activeNowCount(users: ReadonlyArray<{ lastSeenAt?: number | null }>, now: number, windowMs: number): number {
  return users.filter((user) => user.lastSeenAt != null && now - user.lastSeenAt <= windowMs).length
}
