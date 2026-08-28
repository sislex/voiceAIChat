// Здоровье машины для шапки чата (machines-roadmap п.2): состояние по последней телеметрии агента
// и предупреждения, которые стоит показать ДО запуска хода (офлайн, устаревший агент, мало места/памяти).
import type { AgentInfo } from './agentProtocol'
import { compareVersions } from './version'

export type MachineHealthLevel = 'ok' | 'warn' | 'offline'

export interface MachineHealth {
  level: MachineHealthLevel
  /** Коротко для бейджа: «в сети», «не в сети», «мало места». */
  label: string
  /** Строки для тултипа: версия, CPU, память, диск, возраст телеметрии. */
  details: string[]
  /** Предупреждения перед ходом; пусто — можно запускать. */
  warnings: string[]
}

/** Порог «мало места» на диске машины и «мало памяти» — ниже этого ход на машине может упасть. */
export const LOW_DISK_BYTES = 1 * 1024 ** 3
export const LOW_MEMORY_RATIO = 0.95
/** Телеметрия старше этого — агент, скорее всего, завис/отвалился, хотя сокет ещё числится живым. */
export const STALE_TELEMETRY_MS = 3 * 60_000

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ГБ`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} МБ`
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`
  return `${n} Б`
}

export function machineHealth(agent: AgentInfo | undefined, latestVersion: string, now = Date.now()): MachineHealth {
  if (!agent) return { level: 'offline', label: 'машина не найдена', details: [], warnings: ['Машина хода не найдена — выберите другую в настройках разговора.'] }
  if (!agent.online) return { level: 'offline', label: 'не в сети', details: [agent.lastSeen ? `последний раз в сети ${new Date(agent.lastSeen).toLocaleString('ru-RU')}` : 'ещё не подключалась'], warnings: [`Машина «${agent.name}» не в сети: ход будет ждать её возврата или упадёт.`] }
  const details: string[] = []
  const warnings: string[] = []
  if (agent.version) {
    details.push(`агент v${agent.version}`)
    if (compareVersions(agent.version, latestVersion) < 0) warnings.push(`Агент на «${agent.name}» устарел (v${agent.version}, доступна v${latestVersion}) — часть инструментов недоступна.`)
  }
  const t = agent.telemetry
  if (t) {
    details.push(`CPU ${Math.round(t.cpu.loadPct)}% · ${t.cpu.count} ядер`)
    details.push(`память ${formatBytes(t.mem.usedBytes)} / ${formatBytes(t.mem.totalBytes)}`)
    if (t.disk.root) details.push(`диск / свободно ${formatBytes(t.disk.root.freeBytes)}`)
    if (t.disk.work && t.disk.work !== t.disk.root) details.push(`рабочий каталог свободно ${formatBytes(t.disk.work.freeBytes)}`)
    const ageSec = Math.max(0, Math.round((now - t.ts) / 1000))
    details.push(`телеметрия ${ageSec < 5 ? 'только что' : `${ageSec} с назад`}`)
    if (now - t.ts > STALE_TELEMETRY_MS) warnings.push(`Телеметрия «${agent.name}» не обновлялась ${Math.round((now - t.ts) / 60_000)} мин — агент может не отвечать.`)
    const disk = t.disk.work ?? t.disk.root
    if (disk && disk.freeBytes < LOW_DISK_BYTES) warnings.push(`На «${agent.name}» мало места: свободно ${formatBytes(disk.freeBytes)}.`)
    if (t.mem.totalBytes > 0 && t.mem.usedBytes / t.mem.totalBytes > LOW_MEMORY_RATIO) warnings.push(`На «${agent.name}» почти нет свободной памяти (${formatBytes(t.mem.totalBytes - t.mem.usedBytes)}).`)
  } else details.push('телеметрии нет (агент старее 0.4)')
  return { level: warnings.length ? 'warn' : 'ok', label: warnings.length ? 'есть предупреждения' : 'в сети', details, warnings }
}
