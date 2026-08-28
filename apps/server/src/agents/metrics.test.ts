import { describe, it, expect } from 'vitest'
import { formatMachineMetrics } from './metrics'

describe('formatMachineMetrics', () => {
  it('экспонирует гауджи по машинам с метками и пропускает отсутствующую телеметрию', () => {
    const text = formatMachineMetrics({
      generatedAt: 1,
      totals: { machines: 2, online: 1, commands24h: 3, errors24h: 1 },
      machines: [
        { id: 'a', name: 'Мак "prod"', owner: 'bob', online: true, version: '0.15.0', commandsTotal: 10, commands24h: 3, errors24h: 1, avgDurationMs24h: 250, lastCommandAt: 5, offlineEvents30d: 2, offlineMs30d: 120000, cpuLoadPct: 12.5, memUsedRatio: 0.5, diskFreeBytes: 1000 },
        { id: 'b', name: 'Спит', owner: 'bob', online: false, commandsTotal: 0, commands24h: 0, errors24h: 0, avgDurationMs24h: 0, lastCommandAt: null, offlineEvents30d: 0, offlineMs30d: 0 }
      ]
    })
    expect(text).toContain('voicechat_machines_online 1')
    expect(text).toContain('voicechat_machine_online{machine="Мак \\"prod\\"",machine_id="a",owner="bob"} 1')
    expect(text).toContain('voicechat_machine_commands_total{machine="Мак \\"prod\\"",machine_id="a",owner="bob"} 10')
    expect(text).toContain('voicechat_machine_cpu_load_pct{machine="Мак \\"prod\\"",machine_id="a",owner="bob"} 12.5')
    expect(text).not.toContain('voicechat_machine_cpu_load_pct{machine="Спит"')
    expect(text.endsWith('\n')).toBe(true)
  })
})
