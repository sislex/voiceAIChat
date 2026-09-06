// Раннер интеграционных тестов: как и Component QA, он выполняется в checkout
// завершившегося development-рана и обязан сам поставить зависимости — иначе
// первая же стадия с npm-бинарём падает с кодом 127 (регрессия CHAT-411).

import { describe, expect, it, vi } from 'vitest'
import type { IntegrationTestRun } from '@voicechat/shared'
import type { CommandExecRequest, CommandExecResult } from './types.js'
import { createIntegrationTestRunner, type IntegrationTestFinishInput } from './integrationTests.js'

type Outcome = CommandExecResult & { output?: string }

/** Раннер начинает с разбора коммита, поэтому `git`-команды отвечают заранее. */
function setup(commands: string[], outcomes: Outcome[], opts: { npmCacheDir?: string | null; cached?: boolean; testCases?: IntegrationTestRun['testCases']; baseBranch?: string; mergeBase?: Outcome; diff?: string; fallbackDiff?: string; markers?: string } = {}) {
  const run = { id: 'run1', status: 'queued', projectId: 'p1', taskId: 't1', commitSha: 'c'.repeat(40), testCases: opts.testCases ?? [] } as unknown as IntegrationTestRun
  const finished: IntegrationTestFinishInput[] = []
  const calls: CommandExecRequest[] = []
  const links: Array<{ testId: string; path: string }> = []
  const logs: string[] = []
  const gateResults: Array<{ commitSha: string; signature: string }> = []
  const db = {
    integrationTestExecutionContext: () => ({ agentId: 'agent', workdir: '/ws', npmCacheDir: 'npmCacheDir' in opts ? opts.npmCacheDir ?? null : '/cache/task', commands, ciBaseBranch: opts.baseBranch ?? 'main' }),
    findPassedGateResult: (commitSha: string, signature: string) => {
      if (opts.cached) return { runKind: 'component_qa', runId: 'previous-run', createdAt: 0 }
      return gateResults.some((item) => item.commitSha === commitSha && item.signature === signature) ? { runKind: 'integration_tests', runId: 'run1', createdAt: 0 } : null
    },
    recordPassedGateResult: (args: { commitSha: string; signature: string }) => { gateResults.push({ commitSha: args.commitSha, signature: args.signature }) },
    getIntegrationTestRun: () => run,
    markIntegrationTestRunning: () => { run.status = 'running' },
    appendIntegrationTestLog: (_runId: string, chunk: string) => { logs.push(chunk) },
    recordIntegrationAutomationLinks: (_userId: string, _runId: string, covered: Array<{ testId: string; path: string }>) => { links.push(...covered); return run },
    finishIntegrationTestRun: (_userId: string, _runId: string, input: IntegrationTestFinishInput) => { finished.push(input); run.status = input.status; return run }
  }
  let stage = 0
  const executor = {
    run: vi.fn(async (req: CommandExecRequest, onChunk: (data: string) => void) => {
      calls.push(req)
      let gitOutcome: Outcome | null = null
      if (req.script.startsWith('git merge-base ')) gitOutcome = opts.mergeBase ?? { exitCode: 0, timedOut: false, output: 'm123\n' }
      else if (req.script === "git diff --name-only 'm123' HEAD") gitOutcome = { exitCode: 0, timedOut: false, output: opts.diff ?? 'src/app.test.ts\n' }
      else if (req.script === 'git diff-tree --no-commit-id --name-only -r -m --first-parent HEAD') gitOutcome = { exitCode: 0, timedOut: false, output: opts.fallbackDiff ?? opts.diff ?? 'src/app.test.ts\n' }
      else if (req.script === 'git rev-parse HEAD') gitOutcome = { exitCode: 0, timedOut: false, output: 'c'.repeat(40) }
      if (gitOutcome) {
        if (gitOutcome.output) onChunk(gitOutcome.output)
        return { exitCode: gitOutcome.exitCode, timedOut: gitOutcome.timedOut }
      }
      if (req.script.startsWith('grep -HoE')) { onChunk(opts.markers ?? ''); return { exitCode: 0, timedOut: false } }
      const outcome = outcomes[stage++] ?? { exitCode: 0, timedOut: false }
      if (outcome.output) onChunk(outcome.output)
      return { exitCode: outcome.exitCode, timedOut: outcome.timedOut }
    })
  }
  const stageEvents: Array<{ projectId: string; taskId: string }> = []
  const completions: Array<{ passed: boolean; reason: string; classification?: string | null }> = []
  const runner = createIntegrationTestRunner({
    db, executor, now: () => 0,
    qaStageChanged: (projectId, taskId) => { stageEvents.push({ projectId, taskId }) },
    completed: (_runId, _userId, passed, reason, classification) => { completions.push({ passed, reason, classification }) }
  })
  return { runner, finished, calls, links, logs, gateResults, stageEvents, completions }
}

describe('createIntegrationTestRunner', () => {
  // @testCase TC-MERGE-1
  it('merge-коммит обрабатывает полным diff относительно merge-base', async () => {
    const testCases = [{ id: 'TC-A', required: true, automatable: true }] as unknown as IntegrationTestRun['testCases']
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }], {
      baseBranch: 'develop',
      testCases,
      diff: 'tests/a.test.ts\n',
      markers: 'tests/a.test.ts:@testCase TC-A\n'
    })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.calls.slice(0, 2).map((call) => call.script)).toEqual([
      "git merge-base 'origin/develop' HEAD",
      "git diff --name-only 'm123' HEAD"
    ])
    expect(s.links).toEqual([{ testId: 'TC-A', path: 'tests/a.test.ts' }])
    expect(s.finished[0].status).toBe('passed')
  })

  // @testCase TC-MERGE-2
  it('при ошибке merge-base использует first-parent fallback', async () => {
    const testCases = [{ id: 'TC-A', required: true, automatable: true }] as unknown as IntegrationTestRun['testCases']
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }], {
      mergeBase: { exitCode: 128, timedOut: false },
      fallbackDiff: 'tests/a.test.ts\n',
      markers: 'tests/a.test.ts:@testCase TC-A\n',
      testCases
    })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.calls.slice(0, 2).map((call) => call.script)).toEqual([
      "git merge-base 'origin/main' HEAD",
      'git diff-tree --no-commit-id --name-only -r -m --first-parent HEAD'
    ])
    expect(s.links).toEqual([{ testId: 'TC-A', path: 'tests/a.test.ts' }])
    expect(s.finished[0].status).toBe('passed')
  })

  // @testCase TC-MERGE-3
  it('блокирует ран, если основной и fallback diff пусты', async () => {
    const s = setup(['npm run test'], [], { diff: '', fallbackDiff: '' })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.finished[0]).toMatchObject({
      status: 'blocked',
      failureClassification: 'infrastructure',
      failureReason: 'diff_parse_failed',
      blockerReasons: ['diff_parse_failed']
    })
    expect(s.finished[0].summary).toContain('diff пусты')
    expect(s.calls.some((call) => call.script.startsWith('grep') || call.script.includes('npm'))).toBe(false)
  })

  // @testCase TC-COVER-1
  it('блокирует обязательные automatable-кейсы при пустом точном покрытии до кэша и стадий', async () => {
    const testCases = [
      { id: 'TC-A', required: true, automatable: true },
      { id: 'TC-B', required: true, automatable: true }
    ] as unknown as IntegrationTestRun['testCases']
    const s = setup(['npm run test'], [], {
      cached: true,
      testCases,
      diff: 'tests/a.test.ts\n',
      markers: 'tests/a.test.ts:@testCase TC-OTHER\n'
    })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.finished[0]).toMatchObject({
      status: 'blocked',
      failureClassification: 'implementation_defect',
      failureReason: 'missing_automation',
      blockerReasons: ['missing_automation:TC-A', 'missing_automation:TC-B']
    })
    expect(s.links).toEqual([])
    expect(s.calls.some((call) => call.script.includes('npm'))).toBe(false)
  })

  // @testCase TC-NORMAL-COMMIT
  it('ставит зависимости перед стадиями тем же кэшем задачи', async () => {
    const s = setup(['npm run affected-check'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }])
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    // git-разбор коммита и grep маркеров идут до установки — сравниваем хвост.
    const scripts = s.calls.map((call) => call.script).filter((script) => !script.startsWith('git') && !script.startsWith('grep'))
    expect(scripts).toEqual(["npm_config_cache='/cache/task' npm ci --no-audit --no-fund", 'npm run affected-check'])
    const input = s.finished[0]
    expect(input.status).toBe('passed')
    expect(input.commands.map((command) => command.commandId)).toEqual(['install', 'stage-1'])
  })

  it('нет бинаря из node_modules (127) → blocked/infrastructure, а не дефект', async () => {
    const output = 'sh: vitest: command not found\nnpm error code 127\n'
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 127, timedOut: false, output }])
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    const input = s.finished[0]
    expect(input.status).toBe('blocked')
    expect(input.failureClassification).toBe('infrastructure')
    expect(input.blockerReasons).toEqual(['missing_dependencies'])
    expect(input.summary).toContain('заблокирован инфраструктурой')
    // Сбой окружения не должен возвращать карточку в доработку — автопроход
    // получает это отдельной классификацией.
    expect(s.completions[0]?.classification).toBe('infrastructure')
  })

  // Регрессия CHAT-411: `split(/\\r?\\n/)` искал литерал «\r», дифф приходил в
  // валидацию одной склейкой, и коммит разработки проезжал проверку.
  // @testCase TC-REG-1
  it('нетестовые файлы в коммите блокируют ран', async () => {
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }], { diff: 'apps/server/src/db/database.ts\napps/server/src/db/schema.ts\npackages/ui/src/test/fakeApi.ts\n' })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    const input = s.finished[0]
    expect(input.status).toBe('blocked')
    expect(input.failureReason).toBe('non_test_files_changed')
    expect(input.blockerReasons).toEqual(['non_test_file:apps/server/src/db/database.ts', 'non_test_file:apps/server/src/db/schema.ts'])
    // Стадии не запускались: дальше разбора коммита ран не пошёл.
    expect(s.calls.some((call) => call.script.includes('npm'))).toBe(false)
    // Автопроход обязан узнать об исходе: без уведомления карточка застревала в
    // integration_tests, а board-событие запускало следующий такой же ран по кругу.
    expect(s.completions).toEqual([{ passed: false, reason: input.summary, classification: 'implementation_defect' }])
  })

  // @testCase TC-COVER-2
  it('покрытие берётся из маркеров @testCase, а не из первого пути в диффе', async () => {
    const testCases = [
      { id: 'TC-1', required: true, automatable: true },
      { id: 'TC-2', required: true, automatable: true }
    ] as unknown as IntegrationTestRun['testCases']
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }], {
      testCases,
      diff: 'packages/ui/src/test/fakeApi.ts\npackages/ui/src/components/kanban/NewTaskCardView.dom.test.tsx\n',
      markers: 'packages/ui/src/test/fakeApi.ts:@testCase TC-1\npackages/ui/src/components/kanban/NewTaskCardView.dom.test.tsx:@testCase TC-2\npackages/ui/src/test/fakeApi.ts:@testCase TC-IGNORED\n'
    })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.links).toEqual([
      { testId: 'TC-1', path: 'packages/ui/src/test/fakeApi.ts' },
      { testId: 'TC-2', path: 'packages/ui/src/components/kanban/NewTaskCardView.dom.test.tsx' }
    ])
  })

  // @testCase TC-FALLBACK-MARKERS
  it('без маркеров покрытие синтезируется из диффа, как раньше', async () => {
    const testCases = [{ id: 'TC-1', required: true, automatable: true }] as unknown as IntegrationTestRun['testCases']
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }], { testCases, diff: 'packages/ui/src/test/fakeApi.ts\n' })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.links).toEqual([{ testId: 'TC-1', path: 'packages/ui/src/test/fakeApi.ts' }])
    expect(s.logs.join('')).toContain('покрытие синтезировано из диффа')
  })

  it('зелёный прогон запоминается, а готовый результат того же коммита переиспользуется', async () => {
    const first = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }])
    first.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(first.finished).toHaveLength(1))
    expect(first.finished[0].status).toBe('passed')
    expect(first.gateResults).toHaveLength(1)

    const reuse = setup(['npm run test'], [], { cached: true })
    reuse.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(reuse.finished).toHaveLength(1))
    const input = reuse.finished[0]
    expect(input.status).toBe('passed')
    expect(input.commands.map((command) => command.commandId)).toEqual(['cache'])
    expect(input.summary).toContain('результат прошлого прогона')
    // Ни установки зависимостей, ни стадий: только разбор коммита и маркеров.
    expect(reuse.calls.some((call) => call.script.includes('npm'))).toBe(false)
  })

  it('провал стадии остаётся дефектом реализации', async () => {
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 1, timedOut: false, output: '1 test failed\n' }])
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.finished[0]).toMatchObject({ status: 'failed', failureClassification: 'implementation_defect' })
  })
})

it('шлёт адресное событие этапа на старте и на завершении — панель живёт без опроса', async () => {
  const s = setup(['npm run affected-check'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }])
  s.runner.launch('run1', 'bob')
  await vi.waitFor(() => expect(s.finished).toHaveLength(1))
  // Первое событие — переход в running, последнее — завершение рана.
  expect(s.stageEvents.length).toBeGreaterThanOrEqual(2)
  expect(s.stageEvents[0]).toEqual({ projectId: 'p1', taskId: 't1' })
  expect(s.stageEvents.at(-1)).toEqual({ projectId: 'p1', taskId: 't1' })
})
