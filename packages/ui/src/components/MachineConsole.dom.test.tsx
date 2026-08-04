import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MachineConsole } from './MachineConsole'
import type { AgentInfo } from '@shared/agentProtocol'

const agent: AgentInfo = {
  id: 'm1',
  name: 'Мак',
  online: true,
  createdAt: 1,
  lastSeen: null,
  policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] }
}

describe('MachineConsole', () => {
  it('выполняет команду и показывает вывод', async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, output: 'привет-вывод', timedOut: false })
    render(<MachineConsole agents={[agent]} initialAgentId="m1" exec={exec} variant="embedded" />)
    await userEvent.type(screen.getByLabelText('Команда'), 'echo hi')
    await userEvent.click(screen.getByRole('button', { name: 'Выполнить команду' }))
    expect(exec).toHaveBeenCalledWith('m1', 'echo hi')
    expect(await screen.findByText('привет-вывод')).toBeInTheDocument()
    expect(screen.getByText('$ echo hi')).toBeInTheDocument()
  })

  it('ошибка выполнения показывается в истории', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('офлайн'))
    render(<MachineConsole agents={[agent]} initialAgentId="m1" exec={exec} variant="embedded" />)
    await userEvent.type(screen.getByLabelText('Команда'), 'ls')
    await userEvent.click(screen.getByRole('button', { name: 'Выполнить команду' }))
    expect(await screen.findByText('офлайн')).toBeInTheDocument()
  })

  it('объясняет, что офлайн-машина переподключается, и не запускает команду', async () => {
    const exec = vi.fn()
    render(<MachineConsole agents={[{ ...agent, online: false }]} initialAgentId="m1" exec={exec} variant="embedded" />)

    expect(screen.getByText('Машина «Мак» переподключается')).toBeInTheDocument()
    expect(screen.getByLabelText('Команда')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Выполнить команду' })).toBeDisabled()
  })

  it('переключение на весь экран добавляет класс', async () => {
    const exec = vi.fn()
    const { container } = render(
      <MachineConsole agents={[agent]} initialAgentId="m1" exec={exec} variant="embedded" />
    )
    await userEvent.click(screen.getByTitle('На весь экран'))
    expect(container.querySelector('.util-embed--fs')).not.toBeNull()
  })
})
