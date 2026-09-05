import { describe, expect, it, vi } from 'vitest'
import { StorybookSessions, stripAnsi, type StorybookRegistry } from './storybookSessions.js'

interface Fake extends StorybookRegistry {
  emit: (event: { t: string; ptyId: string; data?: string; message?: string }) => void
  inputs: string[]
  killed: string[]
  index: { status: number } | 'error'
}

function fakeRegistry(overrides: Partial<Fake> = {}): Fake {
  const state = {
    live: new Set<string>(),
    emitters: new Map<string, (e: { t: string; ptyId: string; data?: string; message?: string }) => void>()
  }
  const fake: Fake = {
    inputs: [],
    killed: [],
    index: { status: 200 },
    emit: (event) => state.emitters.get(event.ptyId)?.(event),
    ptyStart: (_agentId, ptyId, _cols, _rows, _cwd, emit) => { state.live.add(ptyId); state.emitters.set(ptyId, emit) },
    ptyInput: (ptyId, data) => { fake.inputs.push(`${ptyId}:${data}`) },
    ptyKill: (ptyId) => { state.live.delete(ptyId); fake.killed.push(ptyId) },
    ptyLive: (ptyId) => state.live.has(ptyId),
    http: async () => {
      if (fake.index === 'error') throw new Error('нет ответа')
      return { status: fake.index.status, headers: {}, bodyBase64: Buffer.from(JSON.stringify({ v: 5, entries: {} })).toString('base64') }
    },
    isOnline: () => true,
    nameOf: () => 'MakBook',
    ...overrides
  }
  return fake
}

const target = { agentId: 'agent-1', workspaceId: 'ws:1', path: '/repo' }

describe('StorybookSessions', () => {
  it('до запуска отвечает «остановлен», а не пустотой', () => {
    const sessions = new StorybookSessions({ registry: fakeRegistry() })
    const snapshot = sessions.snapshot('agent-1', 'ws:1')
    expect(snapshot.state).toBe('stopped')
    expect(snapshot.machineName).toBe('MakBook')
    expect(snapshot.port).toBe(6006)
  })

  it('запускает команду в каталоге рабочей копии и ждёт готовности по /index.json', async () => {
    vi.useFakeTimers()
    const registry = fakeRegistry()
    const sessions = new StorybookSessions({ registry, probeIntervalMs: 10 })
    const started = await sessions.start(target)
    expect(started.state).toBe('starting')
    expect(registry.inputs[0]).toContain('npm run storybook -- --port 6006 --no-open --ci')

    await vi.advanceTimersByTimeAsync(20)
    expect(sessions.snapshot('agent-1', 'ws:1').state).toBe('running')
    vi.useRealTimers()
  })

  it('не поднимает второй Storybook для той же копии', async () => {
    vi.useFakeTimers()
    const registry = fakeRegistry()
    const sessions = new StorybookSessions({ registry, probeIntervalMs: 10 })
    await sessions.start(target)
    await sessions.start(target)
    expect(registry.inputs).toHaveLength(1)
    vi.useRealTimers()
  })

  it('второй копии на той же машине даёт следующий свободный порт', async () => {
    vi.useFakeTimers()
    const registry = fakeRegistry()
    const sessions = new StorybookSessions({ registry, probeIntervalMs: 10 })
    await sessions.start(target)
    const second = await sessions.start({ ...target, workspaceId: 'ws:2' })
    expect(second.port).toBe(6007)
    vi.useRealTimers()
  })

  it('копит лог без ANSI и объясняет падение процесса', async () => {
    vi.useFakeTimers()
    const registry = fakeRegistry({ index: 'error' })
    const sessions = new StorybookSessions({ registry, probeIntervalMs: 10 })
    await sessions.start(target)
    registry.emit({ t: 'pty.output', ptyId: 'storybook:ws:1', data: '\x1b[32mstorybook\x1b[0m ошибка сборки' })
    registry.emit({ t: 'pty.exit', ptyId: 'storybook:ws:1' })
    const snapshot = sessions.snapshot('agent-1', 'ws:1')
    expect(snapshot.state).toBe('failed')
    expect(snapshot.error).toContain('не успев собраться')
    expect(snapshot.log).toBe('storybook ошибка сборки')
    vi.useRealTimers()
  })

  it('останавливает сеанс Ctrl-C и убирает сессию', async () => {
    vi.useFakeTimers()
    const registry = fakeRegistry()
    const sessions = new StorybookSessions({ registry, probeIntervalMs: 10 })
    await sessions.start(target)
    const stopped = sessions.stop('agent-1', 'ws:1')
    expect(stopped.state).toBe('stopped')
    expect(registry.inputs.some((line) => line.endsWith('\x03'))).toBe(true)
    expect(registry.killed).toEqual(['storybook:ws:1'])
    vi.useRealTimers()
  })

  it('офлайн-машину не пытается запустить', async () => {
    const sessions = new StorybookSessions({ registry: fakeRegistry({ isOnline: () => false }) })
    await expect(sessions.start(target)).rejects.toThrow('не в сети')
  })

  it('индекс отдаёт только у готовой сессии', async () => {
    vi.useFakeTimers()
    const registry = fakeRegistry()
    const sessions = new StorybookSessions({ registry, probeIntervalMs: 10 })
    await sessions.start(target)
    expect(await sessions.index('agent-1', 'ws:1')).toBeNull()
    await vi.advanceTimersByTimeAsync(20)
    expect(await sessions.index('agent-1', 'ws:1')).toEqual({ v: 5, entries: {} })
    vi.useRealTimers()
  })
})

describe('stripAnsi', () => {
  it('убирает цвета и одиночные возвраты каретки', () => {
    expect(stripAnsi('\x1b[31mошибка\x1b[0m\rготово')).toBe('ошибка\nготово')
  })
})
