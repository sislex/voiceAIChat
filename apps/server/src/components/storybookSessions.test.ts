import { describe, expect, it, vi } from 'vitest'
import { StorybookSessions, stripAnsi, type StorybookRegistry } from './storybookSessions.js'

interface Fake extends StorybookRegistry {
  emit: (event: { t: string; ptyId: string; data?: string; message?: string }) => void
  inputs: string[]
  killed: string[]
  starts: string[]
  index: { status: number } | 'error'
  /** Отвечает ли порт: до запуска — нет, иначе панель решит, что Storybook уже поднят. */
  serving: boolean
}

function fakeRegistry(overrides: Partial<Fake> = {}): Fake {
  const state = {
    live: new Set<string>(),
    emitters: new Map<string, (e: { t: string; ptyId: string; data?: string; message?: string }) => void>()
  }
  const fake: Fake = {
    inputs: [],
    killed: [],
    starts: [],
    index: { status: 200 },
    serving: false,
    emit: (event) => state.emitters.get(event.ptyId)?.(event),
    ptyStart: (_agentId, ptyId, _cols, _rows, _cwd, emit) => { state.live.add(ptyId); state.emitters.set(ptyId, emit); fake.starts.push(ptyId) },
    // Команда «поднимает» dev-сервер: с этого момента порт отвечает.
    ptyInput: (ptyId, data) => { fake.inputs.push(`${ptyId}:${data}`); if (data.includes('storybook')) fake.serving = true },
    ptyKill: (ptyId) => { state.live.delete(ptyId); fake.killed.push(ptyId); fake.serving = false },
    ptyLive: (ptyId) => state.live.has(ptyId),
    http: async () => {
      if (fake.index === 'error' || !fake.serving) throw new Error('нет ответа')
      return { status: fake.index.status, headers: {}, bodyBase64: Buffer.from(JSON.stringify({ v: 5, entries: {} })).toString('base64') }
    },
    isOnline: () => true,
    nameOf: () => 'MakBook',
    ...overrides
  }
  return fake
}

const target = { agentId: 'agent-1', workspaceId: 'ws:1', path: '/repo' }

function settingsStore() {
  let value: string | null = null
  return {
    getAppConfig: async () => value,
    setAppConfig: async (_key: string, next: string) => { value = next }
  }
}

describe('Storybook session recovery', () => {
  it.each([true, false])('restores with surviving port=%s and preserves the original command', async serving => {
    const settings = settingsStore()
    const first = new StorybookSessions({ registry: fakeRegistry(), settings })
    await first.start({ ...target, command: 'npm run custom-storybook', port: 24016 })
    first.dispose()
    const registry = fakeRegistry({ serving })
    const restored = new StorybookSessions({ registry, settings })
    try {
      const results = await Promise.all([restored.refresh(...[target.agentId, target.workspaceId, target.path] as const), restored.refresh(target.agentId, target.workspaceId, target.path)])
      expect(results[0]).toMatchObject({ state: serving ? 'running' : 'starting', port: 24016, adopted: serving })
      expect(registry.starts).toHaveLength(serving ? 0 : 1)
      if (!serving) expect(registry.inputs[0]).toContain('npm run custom-storybook -- --port 24016 --no-open --ci ;')
      expect(JSON.parse((await settings.getAppConfig())!)).toEqual([{ ...target, command: 'npm run custom-storybook', port: 24016 }])
    } finally { restored.dispose() }
  })

  it('removes an intent on explicit stop, including before the first refresh', async () => {
    const settings = settingsStore()
    const first = new StorybookSessions({ registry: fakeRegistry({ serving: true }), settings })
    await first.start(target)
    const restored = new StorybookSessions({ registry: fakeRegistry({ serving: true }), settings })
    await restored.stop(target.agentId, target.workspaceId, target.path)
    expect(await settings.getAppConfig()).toBe('[]')
    const registry = fakeRegistry({ serving: true })
    const next = new StorybookSessions({ registry, settings })
    expect((await next.refresh(target.agentId, target.workspaceId, target.path)).state).toBe('stopped')
    expect(registry.starts).toEqual([])
    first.dispose()
  })

  it('waits for an online agent and attempts failed recovery only once', async () => {
    const settings = settingsStore()
    const first = new StorybookSessions({ registry: fakeRegistry({ serving: true }), settings })
    await first.start(target)
    first.dispose()
    let online = false
    const ptyStart = vi.fn(() => { throw new Error('launch unavailable') })
    const restored = new StorybookSessions({ registry: fakeRegistry({ isOnline: () => online, ptyStart }), settings })
    expect((await restored.refresh(target.agentId, target.workspaceId, target.path)).state).toBe('stopped')
    expect(ptyStart).not.toHaveBeenCalled()
    online = true
    for (let i = 0; i < 2; i++) {
      expect(await restored.refresh(target.agentId, target.workspaceId, target.path)).toMatchObject({ state: 'stopped', error: 'launch unavailable' })
    }
    expect(ptyStart).toHaveBeenCalledTimes(1)
    expect(JSON.parse((await settings.getAppConfig())!)).toHaveLength(1)
  })

  it('reports asynchronous recovery failure as stopped without deleting the intent', async () => {
    const settings = settingsStore()
    const first = new StorybookSessions({ registry: fakeRegistry({ serving: true }), settings })
    await first.start(target)
    first.dispose()
    const registry = fakeRegistry()
    const restored = new StorybookSessions({ registry, settings })
    await restored.refresh(target.agentId, target.workspaceId, target.path)
    registry.emit({ t: 'pty.error', ptyId: 'storybook:ws:1', message: 'build failed' })
    expect(await restored.refresh(target.agentId, target.workspaceId, target.path)).toMatchObject({ state: 'stopped', error: 'build failed' })
    expect(registry.starts).toHaveLength(1)
    expect(JSON.parse((await settings.getAppConfig())!)).toHaveLength(1)
    restored.dispose()
  })
})

describe('StorybookSessions', () => {
  it.each([
    [undefined, 'npm run storybook --'],
    ['npm run custom-storybook', 'npm run custom-storybook --'],
    ['npm exec storybook dev', 'npm exec storybook dev --'],
    ['npx storybook dev', 'npx storybook dev --'],
    ['npm run storybook -- --host 0.0.0.0', 'npm run storybook -- --host 0.0.0.0'],
    [' npm run storybook -- ', 'npm run storybook --'],
    ['storybook dev', 'storybook dev'],
    ['pnpm run storybook', 'pnpm run storybook'],
    ['./start-storybook.sh', './start-storybook.sh']
  ])('forwards launch flags for %s', async (command, expected) => {
    const registry = fakeRegistry()
    const sessions = new StorybookSessions({ registry })
    try {
      const result = await sessions.start({ ...target, command, port: 24016 })
      expect(result.command).toBe(`${expected} --port 24016 --no-open --ci`)
      expect(registry.inputs[0]).toContain(`${expected} --port 24016 --no-open --ci ; printf`)
    } finally {
      await sessions.stop(target.agentId, target.workspaceId, target.path)
    }
  })

  it('до запуска отвечает «остановлен», а не пустотой', () => {
    const sessions = new StorybookSessions({ registry: fakeRegistry() })
    const snapshot = sessions.snapshot('agent-1', 'ws:1', '/repo')
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
    expect(sessions.snapshot('agent-1', 'ws:1', '/repo').state).toBe('running')
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
    const snapshot = sessions.snapshot('agent-1', 'ws:1', '/repo')
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
    const stopped = await sessions.stop('agent-1', 'ws:1', '/repo')
    expect(stopped.state).toBe('stopped')
    expect(registry.inputs.some((line) => line.endsWith('\x03'))).toBe(true)
    expect(registry.killed).toEqual(['storybook:ws:1'])
    vi.useRealTimers()
  })

  it('подхватывает уже работающий Storybook вместо второго процесса', async () => {
    const registry = fakeRegistry({ serving: true })
    const sessions = new StorybookSessions({ registry })
    const session = await sessions.start(target)
    expect(session.state).toBe('running')
    expect(session.adopted).toBe(true)
    expect(registry.starts).toEqual([])
    // Чужой процесс не убиваем: остановка только забывает сессию.
    expect((await sessions.stop('agent-1', 'ws:1', '/repo')).state).toBe('stopped')
    expect(registry.killed).toEqual([])
  })

  it('сессия привязана к каталогу копии: смена пути не выдаёт чужой Storybook за свой', async () => {
    vi.useFakeTimers()
    const registry = fakeRegistry()
    const sessions = new StorybookSessions({ registry, probeIntervalMs: 10 })
    await sessions.start(target)
    await vi.advanceTimersByTimeAsync(20)
    expect(sessions.snapshot('agent-1', 'ws:1', '/repo').state).toBe('running')
    expect(sessions.snapshot('agent-1', 'ws:1', '/other').state).toBe('stopped')
    vi.useRealTimers()
  })

  it('офлайн-машину не пытается запустить', async () => {
    const sessions = new StorybookSessions({ registry: fakeRegistry({ isOnline: () => false }) })
    await expect(sessions.start(target)).rejects.toMatchObject({ statusCode: 409, code: 'machine_offline', message: expect.stringContaining('не в сети') })
  })

  describe('errorCode of a failed session', () => {
    const sentinelExit = (registry: Fake, code: number) => {
      const sentinel = registry.inputs[0]!.match(/(__VCSB_[a-z0-9]+_)%d__/)![1]
      registry.emit({ t: 'pty.output', ptyId: 'storybook:ws:1', data: `\n${sentinel}${code}__\n` })
    }
    it.each([
      ['storybook_exit_nonzero', (registry: Fake) => sentinelExit(registry, 1)],
      ['storybook_exited_before_ready', (registry: Fake) => sentinelExit(registry, 0)],
      ['storybook_exited_before_ready', (registry: Fake) => registry.emit({ t: 'pty.exit', ptyId: 'storybook:ws:1' })],
      ['pty_error', (registry: Fake) => registry.emit({ t: 'pty.error', ptyId: 'storybook:ws:1', message: 'pty closed' })],
      ['storybook_port_busy', (registry: Fake) => {
        registry.emit({ t: 'pty.output', ptyId: 'storybook:ws:1', data: 'Error: listen EADDRINUSE: address already in use :::6006\n' })
        sentinelExit(registry, 1)
      }],
      ['storybook_port_busy', (registry: Fake) => {
        registry.emit({ t: 'pty.output', ptyId: 'storybook:ws:1', data: 'Port 6006 is not available\n' })
        registry.emit({ t: 'pty.exit', ptyId: 'storybook:ws:1' })
      }]
    ] as const)('reports %s', async (code, failure) => {
      const registry = fakeRegistry({ index: 'error' })
      const sessions = new StorybookSessions({ registry })
      try {
        await sessions.start(target)
        failure(registry)
        expect(sessions.snapshot(target.agentId, target.workspaceId, target.path)).toMatchObject({ state: 'failed', errorCode: code })
      } finally { sessions.dispose() }
    })

    it('reports storybook_ready_timeout and clears the code on a successful start', async () => {
      vi.useFakeTimers()
      let now = 0
      const registry = fakeRegistry({ index: 'error' })
      const sessions = new StorybookSessions({ registry, probeIntervalMs: 10, readyTimeoutMs: 50, now: () => now })
      try {
        await sessions.start(target)
        now = 100
        await vi.advanceTimersByTimeAsync(20)
        expect(sessions.snapshot(target.agentId, target.workspaceId, target.path)).toMatchObject({ state: 'failed', errorCode: 'storybook_ready_timeout' })
        registry.index = { status: 200 }
        expect(await sessions.start(target)).toMatchObject({ state: 'starting', errorCode: null })
        await vi.advanceTimersByTimeAsync(20)
        expect(sessions.snapshot(target.agentId, target.workspaceId, target.path)).toMatchObject({ state: 'running', errorCode: null, error: null })
      } finally { sessions.dispose(); vi.useRealTimers() }
    })
  })

  it('refuses with storybook_no_free_port when every port of the range is taken', async () => {
    const sessions = new StorybookSessions({ registry: fakeRegistry() })
    try {
      for (let i = 0; i <= 40; i++) await sessions.start({ ...target, workspaceId: `ws:${i}` })
      await expect(sessions.start({ ...target, workspaceId: 'ws:extra' })).rejects.toMatchObject({ statusCode: 409, code: 'storybook_no_free_port' })
    } finally { sessions.dispose() }
  })

  it('индекс отдаёт только у готовой сессии', async () => {
    vi.useFakeTimers()
    const registry = fakeRegistry()
    const sessions = new StorybookSessions({ registry, probeIntervalMs: 10 })
    await sessions.start(target)
    expect(await sessions.index('agent-1', 'ws:1', '/repo')).toBeNull()
    await vi.advanceTimersByTimeAsync(20)
    expect(await sessions.index('agent-1', 'ws:1', '/repo')).toEqual({ v: 5, entries: {} })
    vi.useRealTimers()
  })
})

describe('stripAnsi', () => {
  it('убирает цвета и одиночные возвраты каретки', () => {
    expect(stripAnsi('\x1b[31mошибка\x1b[0m\rготово')).toBe('ошибка\nготово')
  })
})
