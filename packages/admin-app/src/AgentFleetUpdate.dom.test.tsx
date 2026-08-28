import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentFleetUpdate, fleetMachines } from './AgentFleetUpdate'
import type { AdminUserInfo } from '@shared/admin'

const policy = { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] }
const user = (name: string, agents: Array<{ id: string; name: string; online: boolean; version?: string }>): AdminUserInfo =>
  ({ name, role: 'developer', blocked: false, createdAt: 1, conversationCount: 0, agents: agents.map((a) => ({ ...a, createdAt: 1, lastSeen: null, policy })) }) as AdminUserInfo

describe('AgentFleetUpdate', () => {
  it('считает устаревшими только машины в сети со старой версией', () => {
    const list = fleetMachines([user('bob', [{ id: 'a', name: 'A', online: true, version: '0.14.0' }, { id: 'b', name: 'B', online: false, version: '0.1.0' }, { id: 'c', name: 'C', online: true, version: '0.15.0' }])], '0.15.0')
    expect(list.map((m) => m.outdated)).toEqual([true, false, false])
  })

  it('канарейка: обновляет одну, ждёт новую версию, затем открывает «обновить остальные»', async () => {
    const onUpdate = vi.fn(async () => null)
    const users = [user('bob', [{ id: 'a', name: 'A', online: true, version: '0.14.0' }, { id: 'b', name: 'B', online: true, version: '0.14.0' }])]
    const { rerender } = render(<AgentFleetUpdate users={users} latestVersion="0.15.0" onUpdate={onUpdate} />)
    expect(screen.getByText(/Устарели и в сети: 2 из 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Канарейка: обновить одну' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('a'))
    expect(screen.getByRole('status')).toHaveTextContent('Ждём «A»')
    // канарейка вернулась с новой версией
    rerender(<AgentFleetUpdate users={[user('bob', [{ id: 'a', name: 'A', online: true, version: '0.15.0' }, { id: 'b', name: 'B', online: true, version: '0.14.0' }])]} latestVersion="0.15.0" onUpdate={onUpdate} />)
    fireEvent.click(await screen.findByRole('button', { name: /обновить остальные \(1\)/ }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('b'))
    expect(await screen.findByRole('status')).toHaveTextContent('Команды обновления отправлены')
  })

  it('ошибка обновления машины показывается в строке', async () => {
    const onUpdate = vi.fn(async () => 'Машина не в сети')
    render(<AgentFleetUpdate users={[user('bob', [{ id: 'a', name: 'A', online: true, version: '0.14.0' }])]} latestVersion="0.15.0" onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Обновить агента на A' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Машина не в сети')
  })
})
