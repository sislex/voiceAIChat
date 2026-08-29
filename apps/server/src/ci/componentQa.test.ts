import { describe, expect, it, vi } from 'vitest'
import type { ComponentQaRun, ComponentQaScenarioSnapshot } from '@voicechat/shared'
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
  it('стримит лог и завершает gate успешной команды', async () => {
    const completed = vi.fn()
    const complete = vi.fn()
    const log: Array<[string, string]> = []
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => ({ agentId: 'agent', workdir: '/workspace', command: 'npm run affected-check' }),
        getQaStageRun: () => ({ projectId: 'project', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(),
        appendAutomatedQaLog: (_id, stream, text) => log.push([stream, text]),
        completeQaStageRun: complete,
        updateQaStageRun: vi.fn()
      },
      executor: { run: vi.fn(async (_request, onChunk) => { onChunk('tests passed\\n'); return { exitCode: 0, timedOut: false } }) },
      completed
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(complete).toHaveBeenCalled())
    expect(log[0]).toEqual(['system', expect.stringContaining('$ npm run affected-check')])
    expect(log[1]).toEqual(['out', 'tests passed\\n'])
    expect(complete).toHaveBeenCalledWith('owner', 'run', expect.objectContaining({ gatePassed: true, exitCode: 0 }))
    expect(completed).toHaveBeenCalledWith('run', 'owner', true, 'Автотесты успешно пройдены')
  })

  it('фиксирует timeout как понятную ошибку', async () => {
    const update = vi.fn()
    const runner = createAutomatedQaRunner({
      db: {
        automatedQaExecutionContext: () => ({ agentId: 'agent', workdir: '/workspace', command: 'npm test' }),
        getQaStageRun: () => ({ projectId: 'project', status: 'queued' }),
        markAutomatedQaRunning: vi.fn(), appendAutomatedQaLog: vi.fn(), completeQaStageRun: vi.fn(), updateQaStageRun: update
      },
      executor: { run: vi.fn(async () => ({ exitCode: null, timedOut: true })) }
    })
    runner.launch('run', 'owner')
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith('run', expect.objectContaining({ status: 'failed', error: 'Лимит времени Automated QA исчерпан' })))
  })
})
