// Сбор живой телеметрии машины: ОС, загрузка CPU/памяти, диск, батарея (Android).
// CPU% считаем по дельте суммарных времён os.cpus() между вызовами — loadavg на
// Windows/Android недостоверен, а мгновенный «моментальный» % без дельты невозможен.

import { exec as execCb } from 'node:child_process'
import { existsSync } from 'node:fs'
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os'
import { promisify } from 'node:util'
import type { AgentTelemetry, DiskUsage } from '@voicechat/shared'
import { resolveShellInfo, type ShellResolution } from './platform.js'

const exec = promisify(execCb)
const CMD_TIMEOUT_MS = 5_000
/** bin-каталог Termux (Android): его наличие — признак Termux при урезанном env. */
const TERMUX_BIN = '/data/data/com.termux/files/usr/bin'

/** Работает ли агент внутри Termux (Android). Экспортируется для тестируемости. */
export function isTermux(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERMUX_VERSION) return true
  if (env.PREFIX && env.PREFIX.includes('com.termux')) return true
  return existsSync(TERMUX_BIN)
}

/** Суммарные времена CPU по всем ядрам (в тиках): простой и всего. */
interface CpuTimes {
  idle: number
  total: number
}

function cpuTimes(): CpuTimes {
  let idle = 0
  let total = 0
  for (const c of cpus()) {
    for (const v of Object.values(c.times)) total += v
    idle += c.times.idle
  }
  return { idle, total }
}

/** Разбирает вывод `df -kP <path>` → использование раздела (размеры в КиБ). */
export function parseDf(out: string): DiskUsage | undefined {
  const line = out.trim().split('\n').slice(1)[0]
  if (!line) return undefined
  const cols = line.trim().split(/\s+/)
  // Filesystem  1K-blocks  Used  Available  Capacity  Mounted
  const totalKiB = Number(cols[1])
  const availKiB = Number(cols[3])
  if (!Number.isFinite(totalKiB) || !Number.isFinite(availKiB)) return undefined
  return { totalBytes: totalKiB * 1024, freeBytes: availKiB * 1024 }
}

async function diskUsage(path: string): Promise<DiskUsage | undefined> {
  try {
    const { stdout } = await exec(`df -kP ${JSON.stringify(path)}`, { timeout: CMD_TIMEOUT_MS })
    return parseDf(stdout)
  } catch {
    return undefined
  }
}

/** Разбирает JSON termux-battery-status → поле battery телеметрии. */
export function parseBattery(out: string): AgentTelemetry['battery'] {
  try {
    const j = JSON.parse(out) as { percentage?: number; status?: string }
    if (typeof j.percentage !== 'number') return undefined
    const charging = j.status === 'CHARGING' || j.status === 'FULL'
    return { percent: j.percentage, charging }
  } catch {
    return undefined
  }
}

/** Батарея через termux-battery-status (пакет termux-api). undefined — нет пакета/не Android. */
async function batteryStatus(): Promise<AgentTelemetry['battery']> {
  if (!isTermux()) return undefined
  try {
    const { stdout } = await exec('termux-battery-status', { timeout: CMD_TIMEOUT_MS })
    return parseBattery(stdout)
  } catch {
    // Нет пакета termux-api (команда не найдена) — телеметрия без батареи.
    return undefined
  }
}

/**
 * Создаёт сборщик телеметрии. Хранит предыдущие времена CPU, чтобы вернуть
 * загрузку между вызовами (для первого вызова — с момента старта процесса).
 * @param workDir рабочий каталог агента (для диска рабочего раздела)
 */
export function createTelemetryCollector(
  workDir: string,
  shellInfo: ShellResolution = resolveShellInfo()
): () => Promise<AgentTelemetry> {
  let prev = cpuTimes()
  return async (): Promise<AgentTelemetry> => {
    const now = cpuTimes()
    const dTotal = now.total - prev.total
    const dIdle = now.idle - prev.idle
    prev = now
    const loadPct =
      dTotal > 0 ? Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100))) : 0

    const total = totalmem()
    const [root, work, battery] = await Promise.all([
      diskUsage('/'),
      diskUsage(workDir),
      batteryStatus()
    ])

    return {
      ts: Date.now(),
      os: {
        platform: platform(),
        release: release(),
        arch: arch(),
        isAndroid: isTermux(),
        shell: shellInfo.shell,
        shellDegraded: shellInfo.degraded
      },
      cpu: { count: cpus().length, loadPct },
      mem: { totalBytes: total, usedBytes: Math.max(0, total - freemem()) },
      disk: { ...(root ? { root } : {}), ...(work ? { work } : {}) },
      ...(battery ? { battery } : {})
    }
  }
}
