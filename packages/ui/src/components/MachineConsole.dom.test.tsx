import { describe, it, expect, vi } from 'vitest'
import { machineHistory } from '../lib/machineHistory'
import { rememberListing } from '../lib/machineListing'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MachineConsole } from './MachineConsole'
import type { ConsoleHistoryStore } from '@voicechat/ui-foundation/components/machine'
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
  it('keeps the latest console page small and reveals earlier output on demand', async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, output: 'ok', timedOut: false })
    render(<MachineConsole agents={[agent]} initialAgentId="m1" exec={exec} variant="embedded" />)
    const input = screen.getByLabelText('Команда')
    const run = screen.getByRole('button', { name: 'Выполнить команду' })
    for (let i = 0; i < 201; i++) {
      fireEvent.change(input, { target: { value: 'audit-' + i } })
      await act(async () => { fireEvent.click(run) })
    }
    expect(screen.getAllByRole('button', { name: /^\$ audit-/ })).toHaveLength(100)
    expect(screen.queryByRole('button', { name: '$ audit-0' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '$ audit-200' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Показать предыдущие команды/ }))
    await userEvent.click(screen.getByRole('button', { name: /Показать предыдущие команды/ }))
    expect(screen.getByRole('button', { name: '$ audit-0' })).toBeInTheDocument()
  })

  // @testCase T1
  it('persists 200 commands per agent, searches, clears one machine, and completes without executing', async () => {
    const id = 'history-acceptance'
    const other = 'history-other'
    machineHistory.clear?.(id)
    machineHistory.clear?.(other)
    for (let i = 0; i < 201; i++) machineHistory.push(id, 'command-' + i)
    machineHistory.push(other, 'private-other')
    expect(machineHistory.get(id)).toHaveLength(200)
    expect(machineHistory.get(id)[0]).toBe('command-1')
    const exec = vi.fn()
    const agents = [{ ...agent, id }, { ...agent, id: other }]
    const view = render(<MachineConsole agents={agents} initialAgentId={id} initialCwd="/r" exec={exec} variant="embedded" />)
    const input = screen.getByLabelText('Команда')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue('command-200')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue('')
    fireEvent.keyDown(input, { key: 'r', ctrlKey: true })
    fireEvent.change(screen.getByLabelText('Обратный поиск'), { target: { value: 'command-199' } })
    await userEvent.click(screen.getByRole('button', { name: 'command-199' }))
    expect(input).toHaveValue('command-199')
    rememberListing(id, '/r', [{ name: 'my folder', kind: 'dir', size: 0, mtime: 0 }])
    fireEvent.change(input, { target: { value: 'cd my' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(input).toHaveValue("cd 'my folder/'")
    expect(exec).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Очистить историю' }))
    expect(machineHistory.get(id)).toEqual([])
    expect(machineHistory.get(other)).toEqual(['private-other'])
    view.unmount()
    render(<MachineConsole agents={agents} initialAgentId={other} exec={exec} variant="embedded" />)
    fireEvent.keyDown(screen.getByLabelText('Команда'), { key: 'ArrowUp' })
    expect(screen.getByLabelText('Команда')).toHaveValue('private-other')
    expect(exec).not.toHaveBeenCalled()
  })

  // @testCase T1
  it('keeps history usable when localStorage is corrupt or rejects writes', async () => {
    const id = 'broken-storage'
    localStorage.setItem('vc:console-history:' + id, '{broken')
    expect(machineHistory.get(id)).toEqual([])
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    try {
      machineHistory.push(id, 'remember despite quota')
      expect(machineHistory.get(id)).toEqual(['remember despite quota'])
      machineHistory.clear?.(id)
      expect(machineHistory.get(id)).toEqual([])
    } finally { write.mockRestore(); read.mockRestore() }
  })

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

  it('навыки машины — чипы над строкой ввода, клик выполняет команду; initialCommand выполняется сразу', async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, output: 'ok', timedOut: false })
    const withSkills: AgentInfo = { ...agent, policy: { ...agent.policy, skills: [{ name: 'логи', command: 'docker logs app', description: 'Логи контейнера' }] } }
    render(<MachineConsole agents={[withSkills]} initialAgentId="m1" exec={exec} variant="embedded" initialCommand="uptime" />)
    await waitFor(() => expect(exec).toHaveBeenCalledWith('m1', 'uptime', expect.anything()))
    const chip = await screen.findByRole('button', { name: '⚡ логи' })
    expect(chip).toHaveAttribute('title', expect.stringContaining('docker logs app'))
    await waitFor(() => expect(chip).not.toBeDisabled())
    await userEvent.click(chip)
    await waitFor(() => expect(exec).toHaveBeenCalledWith('m1', 'docker logs app', expect.anything()))
  })

  it('машина только для чтения: ввод команды заблокирован (п.18)', async () => {
    const exec = vi.fn()
    render(<MachineConsole agents={[{ ...agent, access: 'read', ownership: 'project' }]} initialAgentId="m1" exec={exec} variant="embedded" />)
    const input = screen.getByLabelText('Команда')
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('placeholder', expect.stringContaining('только для чтения'))
    expect(exec).not.toHaveBeenCalled()
  })
})
