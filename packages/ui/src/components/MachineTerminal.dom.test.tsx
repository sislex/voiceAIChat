import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MachineTerminal } from './MachineTerminal'
import { createPtySessionStore } from '../store/ptySessions'
import type { RendererPtyBridge } from '@shared/ipc'
import type { AgentInfo } from '@shared/agentProtocol'

const policy = { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [] }
const mac: AgentInfo = { id: 'm1', name: 'Мак', online: true, createdAt: 1, lastSeen: null, policy }
const box: AgentInfo = { id: 'm2', name: 'Бокс', online: true, createdAt: 2, lastSeen: null, policy }

/** Мост PTY с журналом вызовов: тесты смотрят, кого стартовали и кого убили. */
function fakePty(): RendererPtyBridge & { started: string[]; killed: string[] } {
  const started: string[] = []
  const killed: string[] = []
  return {
    started,
    killed,
    start: ({ ptyId }) => started.push(ptyId),
    input: () => {},
    resize: () => {},
    kill: ({ ptyId }) => killed.push(ptyId),
    onConnected: () => () => {},
    onOutput: () => () => {},
    onExit: () => () => {},
    onError: () => () => {}
  }
}

/** Стор без localStorage и со счётчиком id: вкладки предсказуемы между тестами. */
function store() {
  let n = 0
  return createPtySessionStore({ newId: () => `p${++n}` })
}

describe('MachineTerminal', () => {
  it('размонтирование не убивает сеанс, повторное открытие цепляется к тому же ptyId', async () => {
    const pty = fakePty()
    const sessions = store()
    const view = render(
      <MachineTerminal agents={[mac]} initialAgentId="m1" pty={pty} sessions={sessions} variant="embedded" />
    )
    expect(pty.started).toEqual(['p1'])

    view.unmount()
    expect(pty.killed).toEqual([])

    render(<MachineTerminal agents={[mac]} initialAgentId="m1" pty={pty} sessions={sessions} variant="embedded" />)
    expect(pty.started).toEqual(['p1', 'p1'])
    expect(pty.killed).toEqual([])
  })

  it('закрытие вкладки убивает её сеанс, соседние остаются живы', async () => {
    const pty = fakePty()
    const sessions = store()
    render(<MachineTerminal agents={[mac, box]} initialAgentId="m1" pty={pty} sessions={sessions} variant="embedded" />)

    await userEvent.click(screen.getByRole('button', { name: 'Новый сеанс' }))
    expect(sessions.snapshot().tabs.map((t) => t.ptyId)).toEqual(['p1', 'p2'])

    await userEvent.click(screen.getByRole('button', { name: 'Закрыть сеанс: Мак #1' }))
    expect(pty.killed).toEqual(['p1'])
    expect(sessions.snapshot().tabs.map((t) => t.ptyId)).toEqual(['p2'])
  })

  it('переключение вкладок не убивает соседей, вкладки бывают на разных машинах', async () => {
    const pty = fakePty()
    const sessions = store()
    sessions.open('m1')
    sessions.open('m2')
    render(<MachineTerminal agents={[mac, box]} initialAgentId="m1" pty={pty} sessions={sessions} variant="embedded" />)

    expect(screen.getByRole('button', { name: 'Мак', pressed: true })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Бокс' }))
    expect(sessions.snapshot().activeId).toBe('p2')
    expect(pty.killed).toEqual([])
    // Переключение — это переподписка: стартовали обе вкладки, последняя — выбранная.
    expect(pty.started).toContain('p1')
    expect(pty.started[pty.started.length - 1]).toBe('p2')
  })

  it('«Завершить сеанс» — явное убийство активного PTY', async () => {
    const pty = fakePty()
    const sessions = store()
    render(<MachineTerminal agents={[mac]} initialAgentId="m1" pty={pty} sessions={sessions} variant="embedded" />)

    await userEvent.click(screen.getByRole('button', { name: 'Завершить сеанс' }))
    expect(pty.killed).toEqual(['p1'])
    expect(screen.getByText('Нет открытых сеансов')).toBeInTheDocument()
  })

  it('офлайн-машина объясняет себя во вкладке, сеанс при этом не стартует', () => {
    const pty = fakePty()
    const sessions = store()
    render(
      <MachineTerminal
        agents={[{ ...mac, online: false }]}
        initialAgentId="m1"
        pty={pty}
        sessions={sessions}
        variant="embedded"
      />
    )
    expect(screen.getByText('Машина «Мак» переподключается')).toBeInTheDocument()
    expect(pty.started).toEqual([])
  })
})
