/** Minimum free space on each release machine: 10 GiB. */
export const RELEASE_MIN_FREE_BYTES = 10 * 1024 ** 3
export const RELEASE_DISK_LOW = 'release_disk_low' as const

export interface ReleaseDiskCheck {
  role: 'build' | 'production'
  machineId: string | null
  machineName: string
  freeBytes: number | null
  minBytes: number
  ok: boolean
  measuredAt: number
  error?: string
}

export interface ReleaseDiskPreflight {
  ok: boolean
  checks: ReleaseDiskCheck[]
}

/** HTTP 409 response from release branch creation or deployment. */
export interface ReleaseDiskLowResponse {
  code: typeof RELEASE_DISK_LOW
  error: string
  preflight: ReleaseDiskPreflight
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) {
    throw new TypeError('Invalid release disk preflight object')
  }
  return value as Record<string, unknown>
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const quantity = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Reject malformed data and contradictory success flags; never coerce wire values. */
export function parseReleaseDiskPreflight(value: unknown): ReleaseDiskPreflight {
  const source = record(value, ['ok', 'checks'])
  if (typeof source.ok !== 'boolean' || !Array.isArray(source.checks) || source.checks.length === 0) {
    throw new TypeError('Invalid release disk preflight')
  }
  const checks = Array.from(source.checks, (value): ReleaseDiskCheck => {
    const check = record(value, ['role', 'machineId', 'machineName', 'freeBytes', 'minBytes', 'ok', 'measuredAt', 'error'])
    if ((check.role !== 'build' && check.role !== 'production')
      || (check.machineId !== null && !text(check.machineId)) || !text(check.machineName)
      || (check.freeBytes !== null && !quantity(check.freeBytes)) || !quantity(check.minBytes)
      || !quantity(check.measuredAt) || typeof check.ok !== 'boolean'
      || ('error' in check && !text(check.error))) {
      throw new TypeError('Invalid release disk check')
    }
    if (check.freeBytes === null
      ? check.ok || !text(check.error)
      : check.ok !== (check.freeBytes >= check.minBytes) || 'error' in check) {
      throw new TypeError('Inconsistent release disk check')
    }
    return {
      role: check.role, machineId: check.machineId, machineName: check.machineName,
      freeBytes: check.freeBytes, minBytes: check.minBytes, ok: check.ok, measuredAt: check.measuredAt,
      ...(typeof check.error === 'string' ? { error: check.error } : {}),
    }
  })
  if (source.ok !== checks.every(check => check.ok)) throw new TypeError('Inconsistent release disk preflight')
  return { ok: source.ok, checks }
}

function space(bytes: number): string {
  return `${Number((bytes / 1024 ** 3).toFixed(2))} ГиБ (${bytes} байт)`
}

export function releaseDiskCleanupPrompt(check: ReleaseDiskCheck): string {
  const free = check.freeBytes === null ? `не удалось измерить (${check.error ?? 'причина неизвестна'})` : space(check.freeBytes)
  return `Помоги освободить место на машине «${check.machineName}» для релиза. `
    + `Свободно: ${free}. Минимально требуется: ${space(check.minBytes)}.\n`
    + 'Найди, что можно безопасно удалить: неиспользуемые образы Docker, кэш сборки, старые релизы и логи, устаревшие рабочие каталоги (workspaces). '
    + 'Покажи размеры найденного и объясни, что безопасно удалить и почему. '
    + 'Ничего не удаляй без явного подтверждения пользователя в этом чате. Никогда не трогай личные файлы.'
}
