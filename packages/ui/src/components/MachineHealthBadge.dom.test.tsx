import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MachineHealthBadge, MachineHealthWarnings } from './MachineHealthBadge'
import { AGENT_VERSION } from '@shared/version'
import type { AgentInfo } from '@shared/agentProtocol'

const agent: AgentInfo = {
  id: 'm1', name: 'Мак', online: true, createdAt: 1, lastSeen: 5, version: AGENT_VERSION,
  policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] },
  telemetry: { ts: Date.now(), os: { platform: 'darwin', release: '25', arch: 'arm64', isAndroid: false }, cpu: { count: 8, loadPct: 10 }, mem: { totalBytes: 16 * 1024 ** 3, usedBytes: 4 * 1024 ** 3 }, disk: { root: { totalBytes: 500 * 1024 ** 3, freeBytes: 100 * 1024 ** 3 } } }
}

describe('MachineHealthBadge', () => {
  it('здоровая машина: зелёный бейдж с телеметрией в title и без предупреждений', () => {
    render(<><MachineHealthBadge agent={agent} /><MachineHealthWarnings agent={agent} /></>)
    const badge = screen.getByTestId('head-machine')
    expect(badge).toHaveClass('mhealth--ok')
    expect(badge).toHaveAttribute('title', expect.stringContaining('CPU 10% · 8 ядер'))
    expect(screen.queryByTestId('machine-health-warnings')).toBeNull()
  })

  it('офлайн и устаревший агент — предупреждения перед ходом', () => {
    render(<><MachineHealthBadge agent={{ ...agent, online: false }} /><MachineHealthWarnings agent={{ ...agent, version: '0.10.0' }} /></>)
    expect(screen.getByTestId('head-machine')).toHaveClass('mhealth--offline')
    expect(screen.getByTestId('machine-health-warnings')).toHaveTextContent('устарел')
  })
})
