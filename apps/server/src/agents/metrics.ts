// Метрики машин в формате Prometheus (machines-roadmap п.5): текстовая экспозиция поверх AdminMachineStats.
import type { AdminMachineStats } from '@voicechat/shared'

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

export function formatMachineMetrics(stats: AdminMachineStats): string {
  const lines: string[] = []
  const series = (name: string, help: string, type: 'gauge' | 'counter', rows: Array<[Record<string, string>, number | undefined]>): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`)
    for (const [labels, value] of rows) {
      if (value === undefined) continue
      lines.push(`${name}{${Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(',')}} ${value}`)
    }
  }
  const label = (m: AdminMachineStats['machines'][number]): Record<string, string> => ({ machine: m.name, machine_id: m.id, owner: m.owner })
  lines.push('# HELP voicechat_machines Машин зарегистрировано', '# TYPE voicechat_machines gauge', `voicechat_machines ${stats.totals.machines}`)
  lines.push('# HELP voicechat_machines_online Машин в сети', '# TYPE voicechat_machines_online gauge', `voicechat_machines_online ${stats.totals.online}`)
  series('voicechat_machine_online', 'Машина в сети (1/0)', 'gauge', stats.machines.map((m) => [label(m), m.online ? 1 : 0]))
  series('voicechat_machine_commands_total', 'Команд выполнено за всё время журнала', 'counter', stats.machines.map((m) => [label(m), m.commandsTotal]))
  series('voicechat_machine_commands_24h', 'Команд за последние 24 ч', 'gauge', stats.machines.map((m) => [label(m), m.commands24h]))
  series('voicechat_machine_command_errors_24h', 'Команд с ошибкой за 24 ч', 'gauge', stats.machines.map((m) => [label(m), m.errors24h]))
  series('voicechat_machine_command_avg_duration_ms_24h', 'Средняя длительность команды за 24 ч', 'gauge', stats.machines.map((m) => [label(m), m.avgDurationMs24h]))
  series('voicechat_machine_offline_events_30d', 'Тревог watchdog за 30 дней', 'gauge', stats.machines.map((m) => [label(m), m.offlineEvents30d]))
  series('voicechat_machine_offline_ms_30d', 'Суммарный простой по тревогам за 30 дней, мс', 'gauge', stats.machines.map((m) => [label(m), m.offlineMs30d]))
  series('voicechat_machine_cpu_load_pct', 'Загрузка CPU по телеметрии', 'gauge', stats.machines.map((m) => [label(m), m.cpuLoadPct]))
  series('voicechat_machine_mem_used_ratio', 'Доля занятой памяти по телеметрии', 'gauge', stats.machines.map((m) => [label(m), m.memUsedRatio]))
  series('voicechat_machine_disk_free_bytes', 'Свободно на диске машины (рабочий каталог или /)', 'gauge', stats.machines.map((m) => [label(m), m.diskFreeBytes]))
  return lines.join('\n') + '\n'
}
