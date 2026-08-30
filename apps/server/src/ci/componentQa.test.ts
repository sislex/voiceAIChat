import { describe, expect, it, vi } from 'vitest'
import type { AutomatedQaVerdict, ComponentQaRun, ComponentQaScenarioSnapshot } from '@voicechat/shared'
import type { AutomatedQaExecutionContext } from '../db/database.js'
import type { CommandExecRequest, CommandExecResult } from './types.js'
import { createAutomatedQaRunner, createComponentQaRunner, type ComponentQaFinishInput } from './componentQa.js'

function scenario(): ComponentQaScenarioSnapshot {
  return { testCase: { id: 'tc1', title: 'Кнопка' } as unknown as ComponentQaScenarioSnapshot['testCase'], version: 1, semanticHash: 'v1', status: 'pending', actualResult: '', diagnostic: '' }
}

type Outcome = CommandExecResult & { output?: string; advanceMs?: number }

function setup(commands: string[] | null, outcomes: Outcome[], opts: { timeoutMs?: number } = {}) {
  let t = 0
  const run = { id: 'run1', status: 'queued', scenarios: [scenario()] } as unknown as ComponentQaRun
  const finished: ComponentQaFinishInput[] = []
  const calls: CommandExecRequest[] = []
  const log: string[] = []
  const db = {
    componentQaExecutionContext: () => (commands ? { agentId: 'agent', workdir: '/ws', commands } : null),
    getComponentQaRun: () => run,
    markComponentQaRunning: () => { run.status = 'running' },
    appendComponentQaLog: (_id: string, _stream: 'stdout' | 'stderr', chunk: string) => { log.push(chunk) },
    finishComponentQaRun: (_userId: string, _runId: string, input: ComponentQaFinishInput) => { finished.push(input); run.status = input.status; return run }
  }
  const executor = {
    run: vi.fn(async (req: CommandExecRequest, onChunk: (data: string) => void) => {
      calls.push(req)
      const outcome = outcomes[calls.length - 1] ?? { exitCode: 0, timedOut: false }
      if (outcome.output) onChunk(outcome.output)
      t += outcome.advanceMs ?? 1000
      return { exitCode: outcome.exitCode, timedOut: outcome.timedOut }
    })
  }
  const runner = createComponentQaRunner({ db, executor, now: () => t, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) })
  return { runner, run, finished, calls, log }
}

describe('createComponentQaRunner', () => {
  it('выполняет стадии последовательно и создаёт отдельную запись команды на каждую', async () => {
    const s = setup(['npm run one', 'npm run two'], [{ exitCode: 0, timedOut: false, output: 'one ok\n' }, { exitCode: 0, timedOut: false, output: 'two ok\n' }])
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.calls.map((call) => call.script)).toEqual(['npm run one', 'npm run two'])
    expect(s.calls.every((call) => call.env.CI === '1')).toBe(true)
    const input = s.finished[0]
    expect(input.status).toBe('passed')
    expect(input.failureClassification).toBeNull()
    expect(input.commands.map((command) => ({ commandId: command.commandId, name: command.name, command: command.command, exitCode: command.exitCode, status: command.status, diagnostic: command.diagnostic }))).toEqual([
      { commandId: 'stage-1', name: 'Стадия 1 из 2', command: 'npm run one', exitCode: 0, status: 'passed', diagnostic: '' },
      { commandId: 'stage-2', name: 'Стадия 2 из 2', command: 'npm run two', exitCode: 0, status: 'passed', diagnostic: '' }
    ])
    expect(input.commands[0].stdout).toBe('one ok\n')
    expect(input.commands[1].stdout).toBe('two ok\n')
    expect(input.commands[0].durationMs).toBe(1000)
    expect(input.scenarios[0].status).toBe('passed')
    expect(s.log).toEqual(['one ok\n', 'two ok\n'])
  })

  it('первый ненулевой код возврата прерывает оставшиеся стадии', async () => {
    const s = setup(['npm run one', 'npm run two', 'npm run three'], [{ exitCode: 0, timedOut: false }, { exitCode: 1, timedOut: false }])
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.calls).toHaveLength(2)
    const input = s.finished[0]
    expect(input.status).toBe('failed')
    expect(input.failureClassification).toBe('implementation_defect')
    expect(input.blockerReasons).toEqual([])
    expect(input.commands).toHaveLength(2)
    expect(input.commands[1]).toMatchObject({ commandId: 'stage-2', status: 'failed', exitCode: 1, diagnostic: 'non_zero_exit' })
    expect(input.scenarios[0]).toMatchObject({ status: 'failed', diagnostic: 'non_zero_exit' })
  })

  it('таймаут стадии даёт blocked/infrastructure с command_timeout', async () => {
    const s = setup(['npm run one'], [{ exitCode: null, timedOut: true }])
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    const input = s.finished[0]
    expect(input.status).toBe('blocked')
    expect(input.failureClassification).toBe('infrastructure')
    expect(input.blockerReasons).toEqual(['command_timeout'])
    expect(input.commands[0]).toMatchObject({ status: 'blocked', diagnostic: 'command_timeout' })
  })

  it('потеря исполнителя даёт blocked/infrastructure с executor_disconnected', async () => {
    const s = setup(['npm run one', 'npm run two'], [{ exitCode: null, timedOut: false }])
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.calls).toHaveLength(1)
    const input = s.finished[0]
    expect(input.status).toBe('blocked')
    expect(input.failureClassification).toBe('infrastructure')
    expect(input.blockerReasons).toEqual(['executor_disconnected'])
    expect(input.commands[0]).toMatchObject({ status: 'blocked', exitCode: null, diagnostic: 'executor_disconnected' })
  })

  it('исчерпание общего бюджета рана блокирует следующую стадию без запуска', async () => {
    const s = setup(['npm run one', 'npm run two'], [{ exitCode: 0, timedOut: false, advanceMs: 6000 }], { timeoutMs: 5000 })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].timeoutMs).toBe(5000)
    const input = s.finished[0]
    expect(input.status).toBe('blocked')
    expect(input.commands[1]).toMatchObject({ commandId: 'stage-2', status: 'blocked', diagnostic: 'command_timeout' })
  })

  it('недоступный workspace даёт blocked с workspace_unavailable', () => {
    const s = setup(null, [])
    s.runner.launch('run1', 'user')
    expect(s.finished).toHaveLength(1)
    expect(s.finished[0]).toMatchObject({ status: 'blocked', failureClassification: 'infrastructure', blockerReasons: ['workspace_unavailable'], commands: [] })
  })

  it('отмена через контроллер прерывает стадии без финализации рана', async () => {
    const run = { id: 'run1', status: 'queued', scenarios: [scenario()] } as unknown as ComponentQaRun
    const finished: ComponentQaFinishInput[] = []
    const executorRun = vi.fn((_req: CommandExecRequest, _onChunk: (data: string) => void, signal?: AbortSignal) =>
      new Promise<CommandExecResult>((resolve) => signal?.addEventListener('abort', () => resolve({ exitCode: null, timedOut: false }))))
    const runner = createComponentQaRunner({
      db: {
        componentQaExecutionContext: () => ({ agentId: 'agent', workdir: '/ws', commands: ['npm run one', 'npm run two'] }),
        getComponentQaRun: () => run,
        markComponentQaRunning: () => { run.status = 'running' },
        appendComponentQaLog: () => {},
        finishComponentQaRun: (_userId, _runId, input) => { finished.push(input); return run }
      },
      executor: { run: executorRun },
      now: () => 0
    })
    runner.launch('run1', 'user')
    runner.cancel('run1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(executorRun).toHaveBeenCalledTimes(1)
    expect(finished).toHaveLength(0)
  })
})

describe('createAutomatedQaRunner', () => {
  const context = (over: Partial<AutomatedQaExecutionContext> = {}): AutomatedQaExecutionContext =>
    ({ agentId: 'agent', workdir: '/workspace', command: 'npm test', mode: 'command', scenarios: [], ...over })

  it('стримит лог, кладёт вердикт и завершает gate успешной команды', async () => {
    const completed = vi.fn()
    const complete = vi.fn()
    const log: Array<[string, string]> = []
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => context({ command: 'npm run affected-check' }),
        getQaStageRun: () => ({ projectId: 'project', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(),
        appendAutomatedQaLog: (_id, stream, text) => log.push([stream, text]),
        completeQaStageRun: complete,
        updateQaStageRun: vi.fn()
      },
      executor: { run: vi.fn(async (_request, onChunk) => { onChunk('tests passed\n'); return { exitCode: 0, timedOut: false } }) },
      completed
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(complete).toHaveBeenCalled())
    expect(log[0]).toEqual(['system', expect.stringContaining('$ npm run affected-check')])
    expect(log[1]).toEqual(['out', 'tests passed\n'])
    expect(complete).toHaveBeenCalledWith('owner', 'run', expect.objectContaining({ gatePassed: true, exitCode: 0, mode: 'command', passed: true }))
    expect(completed).toHaveBeenCalledWith('run', 'owner', true, 'Автотесты успешно пройдены', expect.objectContaining({ classification: null }))
  })

  it('провал команды сохраняет вердикт с хвостом лога и виной реализации', async () => {
    const update = vi.fn()
    const completed = vi.fn()
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => context(),
        getQaStageRun: () => ({ projectId: 'project', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: vi.fn(), updateQaStageRun: update
      },
      executor: { run: vi.fn(async (_request, onChunk) => { onChunk('FAIL src/a.test.ts\n'); return { exitCode: 1, timedOut: false } }) },
      completed
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(completed).toHaveBeenCalled())
    const verdict = completed.mock.calls[0][4] as AutomatedQaVerdict
    expect(verdict.classification).toBe('implementation_defect')
    expect(verdict.logTail).toContain('FAIL src/a.test.ts')
    expect(update).toHaveBeenCalledWith('run', expect.objectContaining({ status: 'failed', result: expect.objectContaining({ exitCode: 1 }) }))
  })

  it('timeout — инфраструктура, а не дефект реализации', async () => {
    const completed = vi.fn()
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => context(),
        getQaStageRun: () => ({ projectId: 'project', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: vi.fn(), updateQaStageRun: vi.fn()
      },
      executor: { run: vi.fn(async () => ({ exitCode: null, timedOut: true })) },
      completed
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(completed).toHaveBeenCalled())
    expect(completed).toHaveBeenCalledWith('run', 'owner', false, 'Лимит времени Automated QA исчерпан', expect.objectContaining({ classification: 'infrastructure' }))
  })

  it('недоступный воркспейс — инфраструктура с вердиктом, а не молчаливый провал', async () => {
    const completed = vi.fn()
    const update = vi.fn()
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => null,
        getQaStageRun: () => ({ projectId: 'project', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: vi.fn(), updateQaStageRun: update
      },
      executor: { run: vi.fn() },
      completed
    })
    runner.launch('run', 'owner')
    expect(update).toHaveBeenCalledWith('run', expect.objectContaining({ status: 'failed', result: expect.objectContaining({ classification: 'infrastructure' }) }))
    expect(completed).toHaveBeenCalledWith('run', 'owner', false, 'Development workspace недоступен', expect.objectContaining({ mode: 'command' }))
  })

  it('режим playwright прогоняет сценарий и отдаёт снимок в вердикте', async () => {
    const complete = vi.fn()
    const progress: Array<{ current: number; total: number; label: string }> = []
    const scenario = { startUrl: 'http://localhost:5173', steps: [{ id: 's1', title: 'Открыть доску', action: { kind: 'click' as const, selector: '#board' } }] }
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => context({ mode: 'playwright', scenarios: [scenario] }),
        getQaStageRun: () => ({ projectId: 'project', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: complete,
        updateQaStageRun: (_id, patch) => { if (patch.progress) progress.push(patch.progress) }
      },
      executor: { run: vi.fn() },
      scenarioRunner: {
        run: async (input) => {
          const step = { id: 's1', title: 'Открыть доску', status: 'passed' as const, detail: '', durationMs: 5 }
          input.onStep?.(step, 0, 1)
          return { steps: [step], screenshotUrl: '/api/qa/runs/run/screenshot', pageErrors: [], blocked: null }
        }
      },
      completed: vi.fn()
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(complete).toHaveBeenCalled())
    expect(complete).toHaveBeenCalledWith('owner', 'run', expect.objectContaining({ mode: 'playwright', passed: true, screenshotUrl: '/api/qa/runs/run/screenshot' }))
    // Имя сценария в подписи прогресса: в наборе иначе непонятно, чей это шаг.
    expect(progress.at(-1)).toEqual({ current: 1, total: 1, label: 'http://localhost:5173: Открыть доску' })
  })

  it('провал шага сценария — дефект реализации с названием шага в итоге', async () => {
    const completed = vi.fn()
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => context({ mode: 'playwright', scenarios: [{ startUrl: 'http://localhost:5173', steps: [{ id: 's1', title: 'Кнопка «Создать»', action: { kind: 'click', selector: '#create' } }] }] }),
        getQaStageRun: () => ({ projectId: 'project', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: vi.fn(), updateQaStageRun: vi.fn()
      },
      executor: { run: vi.fn() },
      scenarioRunner: { run: async () => ({ steps: [{ id: 's1', title: 'Кнопка «Создать»', status: 'failed', detail: 'локатор не найден', durationMs: 12 }], screenshotUrl: null, pageErrors: [], blocked: null }) },
      completed
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(completed).toHaveBeenCalled())
    const verdict = completed.mock.calls[0][4] as AutomatedQaVerdict
    expect(verdict.classification).toBe('implementation_defect')
    expect(verdict.summary).toContain('Кнопка «Создать»')
    expect(verdict.logTail).toContain('локатор не найден')
  })

  it('без настроенного Chromium режим playwright блокируется, а не валит задачу', async () => {
    const completed = vi.fn()
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => context({ mode: 'playwright', scenarios: [{ startUrl: 'http://localhost:5173', steps: [] }] }),
        getQaStageRun: () => ({ projectId: 'project', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: vi.fn(), updateQaStageRun: vi.fn()
      },
      executor: { run: vi.fn() },
      completed
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(completed).toHaveBeenCalled())
    expect(completed.mock.calls[0][4]).toMatchObject({ classification: 'infrastructure', mode: 'playwright' })
  })
})

describe('набор сценариев (круг 20)', () => {
  const ctx = (scenarios: unknown[]): AutomatedQaExecutionContext =>
    ({ agentId: 'agent', workdir: '/w', command: 'npm test', mode: 'playwright', scenarios } as AutomatedQaExecutionContext)

  it('прогоняет все сценарии и считает шаги вместе', async () => {
    const complete = vi.fn()
    const seen: string[] = []
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => ctx([
          { name: 'Вход', startUrl: 'http://a/', steps: [{ id: 's1', title: 'Логин', action: { kind: 'click', selector: '#a' } }] },
          { name: 'Доска', startUrl: 'http://b/', steps: [{ id: 's2', title: 'Карточка', action: { kind: 'click', selector: '#b' } }] }
        ]),
        getQaStageRun: () => ({ projectId: 'p', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: complete, updateQaStageRun: vi.fn()
      },
      executor: { run: vi.fn() },
      scenarioRunner: {
        run: async (input) => {
          seen.push(input.scenario.name ?? input.scenario.startUrl)
          return { steps: input.scenario.steps.map((step) => ({ id: step.id, title: step.title, status: 'passed' as const, detail: '', durationMs: 1 })), screenshotUrl: '/shot', pageErrors: [], blocked: null }
        }
      },
      completed: vi.fn()
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(complete).toHaveBeenCalled())
    expect(seen).toEqual(['Вход', 'Доска'])
    expect(complete).toHaveBeenCalledWith('owner', 'run', expect.objectContaining({ passed: true, summary: 'Пройдено сценариев: 2, шагов 2' }))
  })

  it('первый провалившийся сценарий останавливает набор и назван в итоге', async () => {
    const completed = vi.fn()
    const seen: string[] = []
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => ctx([
          { name: 'Вход', startUrl: 'http://a/', steps: [{ id: 's1', title: 'Логин', action: { kind: 'click', selector: '#a' } }] },
          { name: 'Доска', startUrl: 'http://b/', steps: [{ id: 's2', title: 'Карточка', action: { kind: 'click', selector: '#b' } }] }
        ]),
        getQaStageRun: () => ({ projectId: 'p', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: vi.fn(), updateQaStageRun: vi.fn()
      },
      executor: { run: vi.fn() },
      scenarioRunner: {
        run: async (input) => {
          seen.push(input.scenario.name ?? '')
          return { steps: [{ id: 'x', title: input.scenario.steps[0].title, status: 'failed' as const, detail: 'не найден', durationMs: 1 }], screenshotUrl: null, pageErrors: [], blocked: null }
        }
      },
      completed
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(completed).toHaveBeenCalled())
    // Второй сценарий не запускался: набор остановлен на первом провале.
    expect(seen).toEqual(['Вход'])
    const verdict = completed.mock.calls[0][4] as AutomatedQaVerdict
    expect(verdict.summary).toContain('«Вход»')
    expect(verdict.steps[0].title).toBe('Вход: Логин')
  })

  it('пустой набор — инфраструктура, а не дефект реализации', async () => {
    const completed = vi.fn()
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => ctx([]),
        getQaStageRun: () => ({ projectId: 'p', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: vi.fn(), updateQaStageRun: vi.fn()
      },
      executor: { run: vi.fn() },
      scenarioRunner: { run: async () => ({ steps: [], screenshotUrl: null, pageErrors: [], blocked: null }) },
      completed
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(completed).toHaveBeenCalled())
    expect(completed.mock.calls[0][4]).toMatchObject({ classification: 'infrastructure' })
  })
})
