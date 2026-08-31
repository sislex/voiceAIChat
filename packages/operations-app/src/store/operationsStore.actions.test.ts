// Стор Operations: то, ради чего он устроен именно так.
//
// Весь файл построен вокруг `guard()/current(token)` — защиты от устаревшего
// ответа. Без неё медленный первый запрос, вернувшийся после быстрого второго,
// затирает свежие данные, и экран показывает прошлое. Такие гонки не видны в
// ручном прогоне и воспроизводятся только отложенными промисами, поэтому здесь
// они и проверяются — по одной на каждый раздел стора.
//
// Второе, что тут закрыто: диагностика обязана уходить через `redactDiagnostics`.
// Экран диагностики показывают в поддержке, и токен в нём — это утечка.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createOperationsStore } from './operationsStore'
import type { DiagnosticRecord, MachineCatalogEntry, OperationsDependencies, TerminalSession } from '../contracts'

const online = (id: string, dirs: string[] = ['/work']): MachineCatalogEntry => ({
  id, name: id, platform: 'darwin', online: true, version: '1', capabilities: ['pty'],
  policy: { readOnly: false, network: true, allowedDirs: dirs }
})
const offline = (id: string): MachineCatalogEntry => ({ ...online(id), online: false })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fakeTerminal(id: string) {
  const output: Array<(data: string) => void> = []
  const exit: Array<(code: number | null) => void> = []
  const session: TerminalSession & { closed: number } = {
    id, closed: 0,
    input: vi.fn(), resize: vi.fn(),
    close() { session.closed += 1 },
    onOutput(listener) { output.push(listener); return () => { output.splice(output.indexOf(listener), 1) } },
    onExit(listener) { exit.push(listener); return () => { exit.splice(exit.indexOf(listener), 1) } }
  }
  return { session, emitOutput: (data: string) => output.forEach((fn) => fn(data)), emitExit: () => exit.forEach((fn) => fn(0)) }
}

function deps(overrides: Partial<Record<string, unknown>> = {}): OperationsDependencies {
  return {
    machines: { list: vi.fn().mockResolvedValue([]) },
    terminal: { open: vi.fn() },
    files: { list: vi.fn(), read: vi.fn(), write: vi.fn(), remove: vi.fn(), rename: vi.fn(), mkdir: vi.fn(), exec: vi.fn() },
    observer: {
      claudeProjects: vi.fn().mockResolvedValue([]), claudeSessions: vi.fn().mockResolvedValue([]), claudeTranscript: vi.fn(),
      codexProjects: vi.fn().mockResolvedValue([]), codexSessions: vi.fn().mockResolvedValue([]), codexTranscript: vi.fn(),
      subscribeClaude: vi.fn(() => () => {}), subscribeCodex: vi.fn(() => () => {})
    },
    knowledge: { status: vi.fn().mockResolvedValue(null), search: vi.fn().mockResolvedValue([]), document: vi.fn() },
    ci: { list: vi.fn().mockResolvedValue([]) },
    diagnostics: { collect: vi.fn().mockResolvedValue([]) },
    console: { exec: vi.fn() },
    chat: { resume: vi.fn() },
    projects: { openTask: vi.fn() },
    ...overrides
  } as unknown as OperationsDependencies
}

describe('openUtility — выбор машины', () => {
  it('берёт запрошенную машину, если она в сети', () => {
    const store = createOperationsStore(deps())
    store.actions.applyMachines([online('m1'), online('m2')])
    store.actions.openUtility('console', 'm2')
    expect(store.getState().utility).toMatchObject({ kind: 'console', agentId: 'm2' })
  })

  it('запрошенная машина офлайн — берёт любую в сети, а не открывает пустоту', () => {
    const store = createOperationsStore(deps())
    store.actions.applyMachines([offline('m1'), online('m2')])
    store.actions.openUtility('terminal', 'm1')
    expect(store.getState().utility?.agentId).toBe('m2')
  })

  it('в сети никого — окно не открывается вовсе', () => {
    const store = createOperationsStore(deps())
    store.actions.applyMachines([offline('m1')])
    store.actions.openUtility('console', 'm1')
    expect(store.getState().utility).toBeNull()
  })

  it('без явного пути стартовый каталог берётся из политики машины', () => {
    const store = createOperationsStore(deps())
    store.actions.applyMachines([online('m1', ['/srv/data'])])
    store.actions.openUtility('explorer')
    expect(store.getState().utility?.cwd).toBe('/srv/data')
  })
})

describe('устаревшие ответы не затирают свежие', () => {
  it('машины: медленный первый ответ приходит после быстрого второго', async () => {
    const first = deferred<readonly MachineCatalogEntry[]>()
    const second = deferred<readonly MachineCatalogEntry[]>()
    const list = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const store = createOperationsStore(deps({ machines: { list } }))
    const a = store.actions.refreshMachines()
    const b = store.actions.refreshMachines()
    second.resolve([online('fresh')]); await b
    first.resolve([online('stale')]); await a
    expect(store.getState().machines.map((m) => m.id)).toEqual(['fresh'])
    expect(store.getState().machinesLoading).toBe(false)
  })

  it('база знаний: поиск по старому запросу не подменяет результаты нового', async () => {
    const slow = deferred<unknown[]>()
    const fast = deferred<unknown[]>()
    const search = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    const store = createOperationsStore(deps({ knowledge: { status: vi.fn().mockResolvedValue(null), search, document: vi.fn() } }))
    const a = store.actions.searchKnowledge('старый')
    const b = store.actions.searchKnowledge('новый')
    fast.resolve([{ id: 'new' }]); await b
    slow.resolve([{ id: 'old' }]); await a
    expect(store.getState().knowledge.results).toEqual([{ id: 'new' }])
    expect(store.getState().knowledge.query).toBe('новый')
  })

  it('CI: устаревший список ранов отбрасывается', async () => {
    const slow = deferred<unknown[]>()
    const fast = deferred<unknown[]>()
    const list = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    const store = createOperationsStore(deps({ ci: { list } }))
    const a = store.actions.refreshCi()
    const b = store.actions.refreshCi()
    fast.resolve([{ id: 'new' }]); await b
    slow.resolve([{ id: 'old' }]); await a
    expect(store.getState().ci.runs).toEqual([{ id: 'new' }])
  })

  it('ошибка устаревшего запроса не показывается поверх успешного', async () => {
    const slow = deferred<readonly MachineCatalogEntry[]>()
    const fast = deferred<readonly MachineCatalogEntry[]>()
    const list = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    const store = createOperationsStore(deps({ machines: { list } }))
    const a = store.actions.refreshMachines()
    const b = store.actions.refreshMachines()
    fast.resolve([online('m1')]); await b
    slow.reject(new Error('сеть отвалилась')); await a
    expect(store.getState().machinesError).toBeNull()
    expect(store.getState().machines.map((m) => m.id)).toEqual(['m1'])
  })
})

describe('терминал', () => {
  let store: ReturnType<typeof createOperationsStore>
  let term: ReturnType<typeof fakeTerminal>

  beforeEach(() => {
    term = fakeTerminal('t1')
    store = createOperationsStore(deps({ terminal: { open: vi.fn().mockResolvedValue(term.session) } }))
    store.actions.applyMachines([online('m1')])
    store.actions.openUtility('terminal', 'm1')
  })

  it('вывод сессии копится в состоянии', async () => {
    await store.actions.openTerminal()
    term.emitOutput('раз'); term.emitOutput('два')
    expect(store.getState().terminal).toMatchObject({ sessionId: 't1', output: 'раздва' })
  })

  it('выход процесса снимает id сессии, но оставляет вывод на экране', async () => {
    await store.actions.openTerminal()
    term.emitOutput('лог')
    term.emitExit()
    expect(store.getState().terminal.sessionId).toBeNull()
    expect(store.getState().terminal.output).toBe('лог')
  })

  it('ввод и размер уходят только в текущую сессию', async () => {
    await store.actions.openTerminal()
    store.actions.terminalInput('ls\n'); store.actions.terminalResize(120, 40)
    expect(term.session.input).toHaveBeenCalledWith('ls\n')
    expect(term.session.resize).toHaveBeenCalledWith(120, 40)
    store.actions.closeTerminal()
    store.actions.terminalInput('после закрытия')
    expect(term.session.input).toHaveBeenCalledTimes(1)
  })

  it('закрытие гасит сессию и чистит состояние', async () => {
    await store.actions.openTerminal()
    store.actions.closeTerminal()
    expect(term.session.closed).toBe(1)
    expect(store.getState().terminal).toEqual({ sessionId: null, output: '', error: null })
  })

  it('сессия, открывшаяся после закрытия окна, немедленно гасится и на экран не попадает', async () => {
    // Гонка: пользователь закрыл окно, пока сервер ещё открывал pty.
    const pending = deferred<TerminalSession>()
    const late = fakeTerminal('late')
    const s = createOperationsStore(deps({ terminal: { open: vi.fn().mockReturnValue(pending.promise) } }))
    s.actions.applyMachines([online('m1')])
    s.actions.openUtility('terminal', 'm1')
    const opening = s.actions.openTerminal()
    s.actions.closeTerminal()
    pending.resolve(late.session)
    await opening
    expect(late.session.closed).toBe(1)
    expect(s.getState().terminal.sessionId).toBeNull()
  })
})

describe('диагностика', () => {
  it('записи проходят через вычистку секретов, а не показываются как есть', async () => {
    const records: DiagnosticRecord[] = [
      { category: 'session', label: 'Сессия', value: { token: 'секрет', user: 'admin' } },
      { category: 'realtime', label: 'Транспорт', value: 'Authorization: Bearer abc.def' }
    ]
    const store = createOperationsStore(deps({ diagnostics: { collect: vi.fn().mockResolvedValue(records) } }))
    await store.actions.collectDiagnostics()
    expect(store.getState().diagnostics.records[0].value).toEqual({ user: 'admin' })
    expect(store.getState().diagnostics.records[1].value).toBe('Authorization: [REDACTED]')
  })

  it('сбой сбора показывается ошибкой, а не пустым экраном', async () => {
    const store = createOperationsStore(deps({ diagnostics: { collect: vi.fn().mockRejectedValue(new Error('нет доступа')) } }))
    await store.actions.collectDiagnostics()
    expect(store.getState().diagnostics.loading).toBe(false)
    expect(store.getState().diagnostics.error).toContain('нет доступа')
  })
})

describe('подписка на машины и dispose', () => {
  it('пуш-обновление списка машин попадает в состояние без запроса', () => {
    let push!: (machines: readonly MachineCatalogEntry[]) => void
    const subscribe = vi.fn((listener: (m: readonly MachineCatalogEntry[]) => void) => { push = listener; return () => {} })
    const store = createOperationsStore(deps({ machines: { list: vi.fn().mockResolvedValue([]), subscribe } }))
    push([online('pushed')])
    expect(store.getState().machines.map((m) => m.id)).toEqual(['pushed'])
  })

  it('dispose отписывается от машин и гасит терминал', async () => {
    const off = vi.fn()
    const term = fakeTerminal('t1')
    const store = createOperationsStore(deps({
      machines: { list: vi.fn().mockResolvedValue([]), subscribe: vi.fn(() => off) },
      terminal: { open: vi.fn().mockResolvedValue(term.session) }
    }))
    store.actions.applyMachines([online('m1')])
    store.actions.openUtility('terminal', 'm1')
    await store.actions.openTerminal()
    store.dispose()
    expect(off).toHaveBeenCalled()
    expect(term.session.closed).toBe(1)
  })

  it('после dispose состояние заморожено — поздний ответ его не двигает', async () => {
    const pending = deferred<readonly MachineCatalogEntry[]>()
    const store = createOperationsStore(deps({ machines: { list: vi.fn().mockReturnValue(pending.promise) } }))
    const inflight = store.actions.refreshMachines()
    store.dispose()
    pending.resolve([online('late')])
    await inflight
    expect(store.getState().machines).toEqual([])
  })

  it('reset возвращает начальное состояние и гасит терминал', async () => {
    const term = fakeTerminal('t1')
    const store = createOperationsStore(deps({ terminal: { open: vi.fn().mockResolvedValue(term.session) } }))
    store.actions.applyMachines([online('m1')])
    store.actions.openUtility('terminal', 'm1')
    await store.actions.openTerminal()
    term.emitOutput('лог')
    store.actions.reset()
    expect(term.session.closed).toBe(1)
    expect(store.getState().machines).toEqual([])
    expect(store.getState().utility).toBeNull()
    expect(store.getState().terminal.output).toBe('')
  })
})
