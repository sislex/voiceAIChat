import { Terminal } from '@xterm/xterm'
import { describe, it, expect, vi } from 'vitest'
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
  // @testCase T8
  it('copies, searches, clears, and resizes the xterm buffer with matching help shortcuts', async () => {
    const buffer = { length: 2, getLine: (row: number) => ({ translateToString: () => row === 0 ? 'first line' : 'needle here' }) }
    const bufferSpy = vi.spyOn(Terminal.prototype, 'buffer', 'get').mockReturnValue({ active: buffer } as never)
    const select = vi.spyOn(Terminal.prototype, 'select').mockImplementation(() => {})
    const scroll = vi.spyOn(Terminal.prototype, 'scrollToLine').mockImplementation(() => {})
    const clear = vi.spyOn(Terminal.prototype, 'clear').mockImplementation(() => {})
    const resize = vi.spyOn(Terminal.prototype, 'resize').mockImplementation(() => {})
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    try {
      render(<MachineTerminal agents={[mac]} initialAgentId="m1" pty={fakePty()} sessions={store()} variant="embedded" />)
      await user.click(screen.getByRole('button', { name: 'Копировать вывод' }))
      expect(copy).toHaveBeenCalledWith('first line\nneedle here')
      await user.click(screen.getByRole('button', { name: 'Поиск' }))
      await user.type(screen.getByRole('textbox', { name: 'Поиск по буферу терминала' }), 'needle')
      await user.click(screen.getByRole('button', { name: 'Найти далее' }))
      expect(select).toHaveBeenCalledWith(0, 1, 6)
      expect(scroll).toHaveBeenCalledWith(1)
      await user.click(screen.getByRole('button', { name: 'Перенос строк' }))
      expect(screen.getByRole('button', { name: 'Перенос строк' })).toHaveAttribute('aria-pressed', 'false')
      expect(resize).toHaveBeenCalledWith(1000, expect.any(Number))
      await user.click(screen.getByRole('button', { name: 'Горячие клавиши терминала' }))
      expect(screen.getByRole('list', { name: 'Горячие клавиши терминала' })).toHaveTextContent('Ctrl/Cmd+shift+f')
      await user.click(screen.getByRole('button', { name: 'Очистить экран' }))
      expect(clear).toHaveBeenCalled()
    } finally { bufferSpy.mockRestore(); select.mockRestore(); scroll.mockRestore(); clear.mockRestore(); resize.mockRestore(); copy.mockRestore() }
  })

  // @testCase T8
  it('changes directory only in the linked PTY on the requested machine', () => {
    const pty = fakePty()
    pty.input = vi.fn()
    const sessions = store()
    const id = sessions.open('m1', '/old')
    render(<MachineTerminal agents={[mac, box]} initialAgentId="m1" initialCwd="/new folder" pty={pty} sessions={sessions} variant="embedded" />)
    expect(pty.input).toHaveBeenCalledWith({ ptyId: id, data: "cd -- '/new folder'\r" })
    expect(sessions.snapshot().tabs).toHaveLength(1)
    expect(sessions.snapshot().tabs[0].cwd).toBe('/new folder')
  })

  // @testCase T8
  it('quotes a linked PowerShell directory literally and keeps another machine untouched', () => {
    const pty = fakePty()
    pty.input = vi.fn()
    const sessions = store()
    sessions.open('m2', '/other')
    const id = sessions.open('m1', 'C:/old')
    const windows: AgentInfo = { ...mac, telemetry: { ts: 1, os: { platform: 'win32', release: '', arch: 'x64', isAndroid: false, shell: 'pwsh.exe' }, cpu: { count: 1, loadPct: 0 }, mem: { totalBytes: 1, usedBytes: 0 }, disk: {} } }
    render(<MachineTerminal agents={[windows, box]} initialAgentId="m1" initialCwd="C:/Alice's folder" pty={pty} sessions={sessions} variant="embedded" />)
    expect(pty.input).toHaveBeenCalledTimes(1)
    expect(pty.input).toHaveBeenCalledWith({ ptyId: id, data: "Set-Location -LiteralPath 'C:/Alice''s folder'\r" })
    expect(sessions.snapshot().tabs.find((tab) => tab.agentId === 'm2')?.cwd).toBe('/other')
  })

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
