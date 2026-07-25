// Определение реальных ресурсов, доступных процессу В КОНТЕЙНЕРЕ. Ключевой нюанс:
// os.totalmem()/os.cpus() показывают ресурсы ХОСТА, а не лимит cgroup контейнера.
// Поэтому сначала читаем cgroup (v2, затем v1) и лишь при отсутствии лимита
// откатываемся к хосту. Значения стабильны (лимит контейнера не меняется на лету),
// поэтому считаем их один раз при старте сервера.

import { readFileSync } from 'node:fs'
import { totalmem, cpus } from 'node:os'

/** Итог: сколько памяти и CPU реально доступно процессу. */
export interface SystemResources {
  /** Лимит памяти контейнера (cgroup) либо память хоста, если лимита нет. Байты. */
  memoryLimitBytes: number
  /** Число доступных CPU (cgroup-квота либо ядра хоста). */
  cpuCount: number
}

/** Инъекции для тестируемости (по умолчанию — реальные node:fs/node:os). */
export interface ResourceDeps {
  /** Прочитать файл как строку или вернуть null, если недоступен. */
  readFile(path: string): string | null
  /** Память хоста, байты. */
  totalmem(): number
  /** Число ядер хоста. */
  cpuCount(): number
}

const defaultDeps: ResourceDeps = {
  readFile: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
  totalmem,
  cpuCount: () => cpus().length
}

/** Читает число из файла cgroup; 'max'/пусто/не-число → null. */
function readNumber(path: string, deps: ResourceDeps): number | null {
  const raw = deps.readFile(path)
  if (raw == null) return null
  const t = raw.trim()
  if (t === '' || t === 'max') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Валидный положительный лимит меньше памяти хоста. Огромные значения — это
 * cgroup-sentinel «без лимита» (в v1 ≈ 2^63), их отбрасываем; лимит ≥ памяти
 * хоста тоже считаем отсутствующим (эффективно без ограничения).
 */
function realLimit(raw: number | null, host: number): number | null {
  if (raw == null || raw <= 0 || raw >= host) return null
  return raw
}

/** Лимит памяти: cgroup v2 → cgroup v1 → память хоста. Байты. */
export function readMemoryLimitBytes(deps: ResourceDeps = defaultDeps): number {
  const host = deps.totalmem()
  const v2 = realLimit(readNumber('/sys/fs/cgroup/memory.max', deps), host)
  if (v2 != null) return v2
  const v1 = realLimit(readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes', deps), host)
  if (v1 != null) return v1
  return host
}

/** Ограничивает [1, hostCpus]. */
function clampCpu(n: number, host: number): number {
  return Math.max(1, Math.min(Math.round(n), host))
}

/** Число CPU: cgroup-квота (v2 `cpu.max`, затем v1 cfs) → ядра хоста. */
export function readCpuCount(deps: ResourceDeps = defaultDeps): number {
  const host = deps.cpuCount()
  // cgroup v2: "cpu.max" = "<quota> <period>" либо "max <period>".
  const v2 = deps.readFile('/sys/fs/cgroup/cpu.max')
  if (v2) {
    const [q, p] = v2.trim().split(/\s+/)
    const quota = Number(q)
    const period = Number(p)
    if (q !== 'max' && quota > 0 && period > 0) return clampCpu(quota / period, host)
  }
  // cgroup v1: cfs_quota_us / cfs_period_us (quota = -1 → без лимита).
  const quota = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', deps)
  const period = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_period_us', deps)
  if (quota != null && quota > 0 && period != null && period > 0) {
    return clampCpu(quota / period, host)
  }
  return host
}

/** Считывает ресурсы разово (для старта сервера). */
export function detectResources(deps: ResourceDeps = defaultDeps): SystemResources {
  return {
    memoryLimitBytes: readMemoryLimitBytes(deps),
    cpuCount: readCpuCount(deps)
  }
}
