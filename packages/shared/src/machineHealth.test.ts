import { describe, it, expect } from 'vitest'
import { machineHealth, formatBytes, LOW_DISK_BYTES } from './machineHealth'
import type { AgentInfo } from './agentProtocol'

const base: AgentInfo = {
  id: 'm1', name: 'Мак', online: true, createdAt: 1, lastSeen: 5, version: '0.15.0',
  policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] },
  telemetry: { ts: 1_000_000, os: { platform: 'darwin', release: '25', arch: 'arm64', isAndroid: false }, cpu: { count: 8, loadPct: 12.4 }, mem: { totalBytes: 16 * 1024 ** 3, usedBytes: 8 * 1024 ** 3 }, disk: { root: { totalBytes: 500 * 1024 ** 3, freeBytes: 80 * 1024 ** 3 } } }
}

describe('machineHealth', () => {
  it('здоровая машина: ok, детали с версией/CPU/памятью/диском, без предупреждений', () => {
    const h = machineHealth(base, '0.15.0', 1_002_000)
    expect(h.level).toBe('ok')
    expect(h.details).toEqual(['агент v0.15.0', 'CPU 12% · 8 ядер', 'память 8.0 ГБ / 16.0 ГБ', 'диск / свободно 80.0 ГБ', 'телеметрия только что'])
    expect(h.warnings).toEqual([])
  })

  it('офлайн, устаревший агент, мало места и протухшая телеметрия дают предупреждения', () => {
    expect(machineHealth({ ...base, online: false }, '0.15.0').level).toBe('offline')
    expect(machineHealth(undefined, '0.15.0').warnings[0]).toContain('не найдена')
    const bad = machineHealth({ ...base, version: '0.12.0', telemetry: { ...base.telemetry!, disk: { root: { totalBytes: 1, freeBytes: LOW_DISK_BYTES - 1 } } } }, '0.15.0', 1_000_000 + 10 * 60_000)
    expect(bad.level).toBe('warn')
    expect(bad.warnings.map((w) => w.split(' ')[0])).toEqual(['Агент', 'Телеметрия', 'На'])
  })

  it('formatBytes подбирает единицу', () => {
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(3 * 1024 ** 2)).toBe('3 МБ')
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 ГБ')
  })
})
