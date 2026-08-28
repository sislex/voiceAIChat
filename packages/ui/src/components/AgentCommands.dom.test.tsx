import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentCommands } from './AgentCommands'

describe('AgentCommands — мастер подключения', () => {
  it('шаг 2 ждёт агента, после выхода в сеть — ✓ и доступна пробная команда с выводом', async () => {
    const onTestCommand = vi.fn(async () => ({ exitCode: 0, output: 'Darwin mac 25.0\n' }))
    const props = { name: 'Мак', token: 't', onGetConnectionString: vi.fn(async () => 'vcagent:x'), onTestCommand }
    const { rerender } = render(<AgentCommands {...props} online={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('ждём подключения')
    expect(screen.getByRole('button', { name: 'Выполнить uname -a' })).toBeDisabled()
    rerender(<AgentCommands {...props} online={true} />)
    expect(screen.getByRole('status')).toHaveTextContent('машина в сети')
    fireEvent.click(screen.getByRole('button', { name: 'Выполнить uname -a' }))
    await waitFor(() => expect(screen.getByTestId('agent-test-output')).toHaveTextContent('Darwin mac 25.0'))
    expect(screen.getByTestId('agent-test-output')).toHaveTextContent('код выхода 0')
    expect(onTestCommand).toHaveBeenCalledTimes(1)
  })

  it('без online мастер не показывает шаги (старый режим — только команды)', () => {
    render(<AgentCommands name="Мак" token="t" onGetConnectionString={vi.fn(async () => null)} />)
    expect(screen.queryByTestId('agent-wizard-steps')).toBeNull()
  })
})
