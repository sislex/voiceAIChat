// Раннер интеграционных тестов: как и Component QA, он выполняется в checkout
// завершившегося development-рана и обязан сам поставить зависимости — иначе
// первая же стадия с npm-бинарём падает с кодом 127 (регрессия CHAT-411).

import { describe, expect, it, vi } from 'vitest'
import type { IntegrationTestRun } from '@voicechat/shared'
import type { CommandExecRequest, CommandExecResult } from './types.js'
import { createIntegrationTestRunner, type IntegrationTestFinishInput } from './integrationTests.js'

type Outcome = CommandExecResult & { output?: string }

/** Раннер начинает с разбора коммита, поэтому `git`-команды отвечают заранее. */
function setup(commands: string[], outcomes: Outcome[], opts: { npmCacheDir?: string | null; cached?: boolean; testCases?: IntegrationTestRun['testCases']; diff?: string; markers?: string } = {}) {
  const run = { id: 'run1', status: 'queued', projectId: 'p1', taskId: 't1', commitSha: 'c'.repeat(40), testCases: opts.testCases ?? [] } as unknown as IntegrationTestRun
  const finished: IntegrationTestFinishInput[] = []
  const calls: CommandExecRequest[] = []
  const git: Record<string, string> = { 'git diff-tree --no-commit-id --name-only -r HEAD': opts.diff ?? 'src/app.test.ts\n', 'git rev-parse HEAD': 'c'.repeat(40) }
  const links: Array<{ testId: string; path: string }> = []
  const gateResults: Array<{ commitSha: string; signature: string }> = []
  const db = {
    integrationTestExecutionContext: () => ({ agentId: 'agent', workdir: '/ws', npmCacheDir: 'npmCacheDir' in opts ? opts.npmCacheDir ?? null : '/cache/task', commands }),
    findPassedGateResult: (commitSha: string, signature: string) => {
      if (opts.cached) return { runKind: 'component_qa', runId: 'previous-run', createdAt: 0 }
      return gateResults.some((item) => item.commitSha === commitSha && item.signature === signature) ? { runKind: 'integration_tests', runId: 'run1', createdAt: 0 } : null
    },
    recordPassedGateResult: (args: { commitSha: string; signature: string }) => { gateResults.push({ commitSha: args.commitSha, signature: args.signature }) },
    getIntegrationTestRun: () => run,
    markIntegrationTestRunning: () => { run.status = 'running' },
    appendIntegrationTestLog: () => {},
    recordIntegrationAutomationLinks: (_userId: string, _runId: string, covered: Array<{ testId: string; path: string }>) => { links.push(...covered); return run },
    finishIntegrationTestRun: (_userId: string, _runId: string, input: IntegrationTestFinishInput) => { finished.push(input); run.status = input.status; return run }
  }
  let stage = 0
  const executor = {
    run: vi.fn(async (req: CommandExecRequest, onChunk: (data: string) => void) => {
      calls.push(req)
      if (req.script in git) { onChunk(git[req.script]); return { exitCode: 0, timedOut: false } }
      if (req.script.startsWith('grep -HoE')) { onChunk(opts.markers ?? ''); return { exitCode: 0, timedOut: false } }
      const outcome = outcomes[stage++] ?? { exitCode: 0, timedOut: false }
      if (outcome.output) onChunk(outcome.output)
      return { exitCode: outcome.exitCode, timedOut: outcome.timedOut }
    })
  }
  const runner = createIntegrationTestRunner({ db, executor, now: () => 0 })
  return { runner, finished, calls, links, gateResults }
}

describe('createIntegrationTestRunner', () => {
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
  })

  // Регрессия CHAT-411: `split(/\\r?\\n/)` искал литерал «\r», дифф приходил в
  // валидацию одной склейкой, и коммит разработки проезжал проверку.
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
  })

  it('покрытие берётся из маркеров @testCase, а не из первого пути в диффе', async () => {
    const testCases = [
      { id: 'TC-1', required: true, automatable: true },
      { id: 'TC-2', required: true, automatable: true }
    ] as unknown as IntegrationTestRun['testCases']
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }], {
      testCases,
      diff: 'packages/ui/src/test/fakeApi.ts\npackages/ui/src/components/kanban/NewTaskCardView.dom.test.tsx\n',
      markers: 'packages/ui/src/components/kanban/NewTaskCardView.dom.test.tsx:@testCase TC-2\n'
    })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    // TC-1 маркера не получил и остаётся непокрытым — раньше ему приписали бы
    // первый тестовый путь из диффа.
    expect(s.links).toEqual([{ testId: 'TC-2', path: 'packages/ui/src/components/kanban/NewTaskCardView.dom.test.tsx' }])
  })

  it('без маркеров покрытие синтезируется из диффа, как раньше', async () => {
    const testCases = [{ id: 'TC-1', required: true, automatable: true }] as unknown as IntegrationTestRun['testCases']
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }], { testCases, diff: 'packages/ui/src/test/fakeApi.ts\n' })
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.links).toEqual([{ testId: 'TC-1', path: 'packages/ui/src/test/fakeApi.ts' }])
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
