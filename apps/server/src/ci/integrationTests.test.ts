// Раннер интеграционных тестов: как и Component QA, он выполняется в checkout
// завершившегося development-рана и обязан сам поставить зависимости — иначе
// первая же стадия с npm-бинарём падает с кодом 127 (регрессия CHAT-411).

import { describe, expect, it, vi } from 'vitest'
import type { IntegrationTestRun } from '@voicechat/shared'
import type { CommandExecRequest, CommandExecResult } from './types.js'
import { createIntegrationTestRunner, type IntegrationTestFinishInput } from './integrationTests.js'

type Outcome = CommandExecResult & { output?: string }

/** Раннер начинает с разбора коммита, поэтому `git`-команды отвечают заранее. */
function setup(commands: string[], outcomes: Outcome[], opts: { npmCacheDir?: string | null } = {}) {
  const run = { id: 'run1', status: 'queued', projectId: 'p1', testCases: [] } as unknown as IntegrationTestRun
  const finished: IntegrationTestFinishInput[] = []
  const calls: CommandExecRequest[] = []
  const git: Record<string, string> = { 'git diff-tree --no-commit-id --name-only -r HEAD': 'src/app.test.ts\n', 'git rev-parse HEAD': 'c'.repeat(40) }
  const db = {
    integrationTestExecutionContext: () => ({ agentId: 'agent', workdir: '/ws', npmCacheDir: 'npmCacheDir' in opts ? opts.npmCacheDir ?? null : '/cache/task', commands }),
    getIntegrationTestRun: () => run,
    markIntegrationTestRunning: () => { run.status = 'running' },
    appendIntegrationTestLog: () => {},
    recordIntegrationAutomationLinks: () => run,
    finishIntegrationTestRun: (_userId: string, _runId: string, input: IntegrationTestFinishInput) => { finished.push(input); run.status = input.status; return run }
  }
  let stage = 0
  const executor = {
    run: vi.fn(async (req: CommandExecRequest, onChunk: (data: string) => void) => {
      calls.push(req)
      if (req.script in git) { onChunk(git[req.script]); return { exitCode: 0, timedOut: false } }
      const outcome = outcomes[stage++] ?? { exitCode: 0, timedOut: false }
      if (outcome.output) onChunk(outcome.output)
      return { exitCode: outcome.exitCode, timedOut: outcome.timedOut }
    })
  }
  const runner = createIntegrationTestRunner({ db, executor, now: () => 0 })
  return { runner, finished, calls }
}

describe('createIntegrationTestRunner', () => {
  it('ставит зависимости перед стадиями тем же кэшем задачи', async () => {
    const s = setup(['npm run affected-check'], [{ exitCode: 0, timedOut: false }, { exitCode: 0, timedOut: false }])
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    const scripts = s.calls.map((call) => call.script)
    expect(scripts.slice(2)).toEqual(["npm_config_cache='/cache/task' npm ci --no-audit --no-fund", 'npm run affected-check'])
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

  it('провал стадии остаётся дефектом реализации', async () => {
    const s = setup(['npm run test'], [{ exitCode: 0, timedOut: false }, { exitCode: 1, timedOut: false, output: '1 test failed\n' }])
    s.runner.launch('run1', 'user')
    await vi.waitFor(() => expect(s.finished).toHaveLength(1))
    expect(s.finished[0]).toMatchObject({ status: 'failed', failureClassification: 'implementation_defect' })
  })
})
