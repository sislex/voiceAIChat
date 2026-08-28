import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MachineBatchCommand } from './MachineBatchCommand'
import type { AgentInfo, BatchExecResult } from '@shared/agentProtocol'

const policy = { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] }
const agent = (id: string, name: string, online = true): AgentInfo => ({ id, name, online, createdAt: 1, lastSeen: null, policy })
const result: BatchExecResult = {
  command: 'uptime', startedAt: 1,
  items: [
    { machineId: 'a', machineName: 'A', ran: true, exitCode: 0, timedOut: false, output: 'up 3 days', error: null, durationMs: 120 },
    { machineId: 'b', machineName: 'B', ran: false, exitCode: null, timedOut: false, output: '', error: 'Машина не в сети', durationMs: 0 }
  ],
  totals: { requested: 2, ok: 1, failed: 0, skipped: 1 }
}

describe('MachineBatchCommand', () => {
  it('выбирает машины, запускает команду и показывает сводку с раскрытием вывода', async () => {
    const onRun = vi.fn(async () => result)
    render(<MachineBatchCommand agents={[agent('a', 'A'), agent('b', 'B'), agent('c', 'C', false)]} onRun={onRun} />)
    // офлайн-машины в выборе нет
    expect(screen.queryByLabelText('Машина C')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }))
    await userEvent.type(screen.getByLabelText('Команда для группы машин'), 'uptime')
    fireEvent.click(screen.getByRole('button', { name: 'Выполнить на 2' }))
    await waitFor(() => expect(onRun).toHaveBeenCalledWith(['a', 'b'], 'uptime'))
    expect(await screen.findByRole('status')).toHaveTextContent('успешно 1, с ошибкой 0, не выполнено 1 из 2')
    expect(screen.getByTestId('batch-row-b')).toHaveTextContent('Машина не в сети')
    fireEvent.click(screen.getByRole('button', { name: 'показать' }))
    expect(screen.getByText('up 3 days')).toBeInTheDocument()
  })

  it('ошибка запуска (например, политика команд) показывается алертом', async () => {
    render(<MachineBatchCommand agents={[agent('a', 'A')]} onRun={vi.fn(async () => { throw new Error('Запрещено: политика проекта') })} />)
    fireEvent.click(screen.getByLabelText('Машина A'))
    await userEvent.type(screen.getByLabelText('Команда для группы машин'), 'docker ps')
    fireEvent.click(screen.getByRole('button', { name: 'Выполнить на 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Запрещено')
  })

  it('без машин в сети — подсказка вместо формы', () => {
    render(<MachineBatchCommand agents={[agent('a', 'A', false)]} onRun={vi.fn()} />)
    expect(screen.getByText(/Нет машин в сети/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Команда для группы машин')).toBeNull()
  })
})
