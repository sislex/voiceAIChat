import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MachineStatus } from './MachineStatus'
import { DEFAULT_AGENT_POLICY, type AgentInfo, type AgentTelemetry } from '@shared/agentProtocol'

function telemetry(over: Partial<AgentTelemetry> = {}): AgentTelemetry {
  return {
    ts: 1000,
    os: { platform: 'linux', release: '6.8', arch: 'x64', isAndroid: false },
    cpu: { count: 8, loadPct: 42 },
    mem: { totalBytes: 16 * 1024 ** 3, usedBytes: 8 * 1024 ** 3 },
    disk: {
      root: { totalBytes: 100 * 1024 ** 3, freeBytes: 40 * 1024 ** 3 },
      work: { totalBytes: 100 * 1024 ** 3, freeBytes: 55 * 1024 ** 3 }
    },
    ...over
  }
}

function agent(over: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'a1',
    name: 'Мак',
    online: true,
    createdAt: 0,
    lastSeen: 1,
    policy: { ...DEFAULT_AGENT_POLICY },
    version: '0.4.0',
    telemetry: telemetry(),
    ...over
  }
}

describe('MachineStatus', () => {
  it('онлайн-машина: статус «агент запущен» и телеметрия', () => {
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('агент запущен')).toBeInTheDocument()
    const row = screen.getByTestId('machine-row-a1')
    expect(within(row).getByText(/Linux/)).toBeInTheDocument()
    expect(within(row).getByText(/40\.0 ГБ своб/)).toBeInTheDocument()
  })

  it('офлайн-машина: «не запущен», телеметрия скрыта, чекбоксы заблокированы', () => {
    render(
      <MachineStatus
        agents={[agent({ online: false, telemetry: undefined })]}
        onSetPolicy={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('не запущен')).toBeInTheDocument()
    expect(screen.getByLabelText('Сеть')).toBeDisabled()
  })

  it('андроид: показывает батарею и заряд', () => {
    const a = agent({
      telemetry: telemetry({
        os: { platform: 'android', release: '14', arch: 'arm64', isAndroid: true },
        battery: { percent: 76, charging: true }
      })
    })
    render(<MachineStatus agents={[a]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/76%/)).toBeInTheDocument()
    expect(screen.getByText(/Android/)).toBeInTheDocument()
  })

  it('чекбокс разрешения переключает политику через onSetPolicy', () => {
    const onSetPolicy = vi.fn()
    render(<MachineStatus agents={[agent()]} onSetPolicy={onSetPolicy} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Запись файлов'))
    expect(onSetPolicy).toHaveBeenCalledWith('a1', expect.objectContaining({ allowWrite: false }))
  })

  it('нет машин → подсказка', () => {
    render(<MachineStatus agents={[]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Нет добавленных машин/)).toBeInTheDocument()
  })
})
