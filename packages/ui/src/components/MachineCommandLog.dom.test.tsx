import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MachineCommandLog, commandsToCsv } from './MachineCommandLog'
import type { MachineCommandRecord } from '@shared/agentProtocol'

const rows: MachineCommandRecord[] = [
  { id: 2, machineId: 'm1', userId: 'bob', source: 'chat', command: 'npm test', exitCode: 1, timedOut: false, error: null, durationMs: 2500, startedAt: 1700000000000, conversationId: 'c1', outputExcerpt: 'FAIL' },
  { id: 1, machineId: 'm1', userId: 'bob', source: 'console', command: 'uptime', exitCode: 0, timedOut: false, error: null, durationMs: 40, startedAt: 1699999000000, conversationId: null, outputExcerpt: 'up 3 days' }
]

describe('MachineCommandLog', () => {
  it('показывает записи, фильтрует по источнику и ведёт в чат', async () => {
    const load = vi.fn(async (f: { source?: string }) => (f.source ? rows.filter((r) => r.source === f.source) : rows))
    const onOpenConversation = vi.fn()
    render(<MachineCommandLog machineId="m1" machineName="Мак" load={load} onOpenConversation={onOpenConversation} />)
    expect(await screen.findByText('npm test')).toBeInTheDocument()
    expect(screen.getByText('uptime')).toBeInTheDocument()
    expect(screen.getByTestId('command-row-2')).toHaveClass('mcmdlog-row--failed')
    fireEvent.click(screen.getByTitle('Открыть чат'))
    expect(onOpenConversation).toHaveBeenCalledWith('c1')
    fireEvent.change(screen.getByLabelText('Источник команды'), { target: { value: 'console' } })
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'console' })))
    await waitFor(() => expect(screen.queryByText('npm test')).toBeNull())
    // клик по строке раскрывает вывод
    fireEvent.click(screen.getByTestId('command-row-1'))
    expect(screen.getByText('up 3 days')).toBeInTheDocument()
  })

  it('CSV экранирует кавычки и содержит все колонки', () => {
    const csv = commandsToCsv([{ ...rows[1]!, command: 'echo "hi"' }])
    expect(csv.split('\n')[0]).toBe('startedAt,user,source,command,exitCode,timedOut,durationMs,conversationId,error')
    expect(csv).toContain('"echo ""hi""","0","false","40","",""')
  })

  it('пустой журнал — подсказка, ошибка загрузки — alert', async () => {
    const { rerender } = render(<MachineCommandLog machineId="m1" machineName="Мак" load={vi.fn(async () => [])} />)
    expect(await screen.findByText('Команд пока не было.')).toBeInTheDocument()
    rerender(<MachineCommandLog machineId="m2" machineName="Мак" load={vi.fn(async () => { throw new Error('boom') })} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})
