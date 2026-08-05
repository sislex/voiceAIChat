import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MachineConsole } from './MachineConsole'
import type { ConsoleHistoryStore } from './machine'
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
    expect(exec).toHaveBeenCalledWith('m1', 'echo hi', expect.any(AbortSignal))
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

  it('↑/↓ листают историю сеанса, Esc возвращает пустую строку', async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, output: 'ок', timedOut: false })
    render(<MachineConsole agents={[agent]} initialAgentId="m1" exec={exec} variant="embedded" />)
    const input = screen.getByLabelText('Команда')
    const run = screen.getByRole('button', { name: 'Выполнить команду' })

    await userEvent.type(input, 'ls')
    await userEvent.click(run)
    expect(await screen.findByRole('button', { name: '$ ls' })).toBeInTheDocument()
    await userEvent.type(input, 'pwd')
    await userEvent.click(run)
    expect(await screen.findByRole('button', { name: '$ pwd' })).toBeInTheDocument()

    await userEvent.type(input, '{ArrowUp}')
    expect(input).toHaveValue('pwd')
    await userEvent.type(input, '{ArrowUp}')
    expect(input).toHaveValue('ls')
    await userEvent.type(input, '{ArrowDown}')
    expect(input).toHaveValue('pwd')
    // Ниже последней команды — своя строка, которую листание затёрло (тут пустая).
    await userEvent.type(input, '{ArrowDown}')
    expect(input).toHaveValue('')

    await userEvent.type(input, '{ArrowUp}')
    expect(input).toHaveValue('pwd')
    await userEvent.type(input, '{Escape}')
    expect(input).toHaveValue('')
  })

  it('«Стоп» отменяет команду: пометка в истории и активный ввод', async () => {
    // Мост держит запрос до отмены — так же ведёт себя fetch с оборванным signal.
    const exec = vi.fn(
      (_agentId: string, _command: string, signal?: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Команда отменена')))
        })
    )
    render(<MachineConsole agents={[agent]} initialAgentId="m1" exec={exec} variant="embedded" />)
    await userEvent.type(screen.getByLabelText('Команда'), 'sleep 100')
    await userEvent.click(screen.getByRole('button', { name: 'Выполнить команду' }))

    const stop = await screen.findByRole('button', { name: 'Стоп' })
    // Ввод не заблокирован ожиданием: следующую команду набирают, не дожидаясь.
    expect(screen.getByLabelText('Команда')).not.toBeDisabled()
    await userEvent.click(stop)

    expect(await screen.findByText('Отменено')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Стоп' })).toBeNull()
    expect(screen.getByLabelText('Команда')).not.toBeDisabled()
  })

  it('клик по команде в истории подставляет её в поле ввода', async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, output: 'ок', timedOut: false })
    render(<MachineConsole agents={[agent]} initialAgentId="m1" exec={exec} variant="embedded" />)
    await userEvent.type(screen.getByLabelText('Команда'), 'git status')
    await userEvent.click(screen.getByRole('button', { name: 'Выполнить команду' }))

    await userEvent.click(await screen.findByRole('button', { name: '$ git status' }))
    expect(screen.getByLabelText('Команда')).toHaveValue('git status')
  })

  it('кнопка копирования кладёт вывод сеанса в буфер', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const exec = vi.fn().mockResolvedValue({ exitCode: 2, output: 'привет-вывод', timedOut: false })
    render(<MachineConsole agents={[agent]} initialAgentId="m1" exec={exec} variant="embedded" />)
    await userEvent.type(screen.getByLabelText('Команда'), 'echo hi')
    await userEvent.click(screen.getByRole('button', { name: 'Выполнить команду' }))
    expect(await screen.findByText('привет-вывод')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Копировать вывод' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('$ echo hi\nпривет-вывод\nexit 2'))
  })

  it('история команд по машине переживает переоткрытие утилиты', async () => {
    const stored: Record<string, string[]> = {}
    const historyStore: ConsoleHistoryStore = {
      get: (id) => stored[id] ?? [],
      push: (id, command) => {
        stored[id] = [...(stored[id] ?? []), command]
      }
    }
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, output: 'ок', timedOut: false })
    const view = render(
      <MachineConsole
        agents={[agent]}
        initialAgentId="m1"
        exec={exec}
        historyStore={historyStore}
        variant="embedded"
      />
    )
    await userEvent.type(screen.getByLabelText('Команда'), 'npm test')
    await userEvent.click(screen.getByRole('button', { name: 'Выполнить команду' }))
    expect(await screen.findByRole('button', { name: '$ npm test' })).toBeInTheDocument()
    view.unmount()

    render(
      <MachineConsole
        agents={[agent]}
        initialAgentId="m1"
        exec={exec}
        historyStore={historyStore}
        variant="embedded"
      />
    )
    await userEvent.type(screen.getByLabelText('Команда'), '{ArrowUp}')
    expect(screen.getByLabelText('Команда')).toHaveValue('npm test')
  })
})
