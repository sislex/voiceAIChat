import { describe, expect, it } from 'vitest'
import { CI_INFRA_LABEL, classifyCiInfraFailure, classifyLlmTransportFailure, formatCiInfraFailure } from './infraErrors.js'
import { createTestFixCycleCoordinator, createTestPipelineCoordinator } from './types.js'
import type { TestGroupConfig, TestRun } from '@voicechat/shared'

/** Реальный хвост лога с гонки двух `npm ci` за общий ~/.npm (задача #30). */
const CACACHE_EEXIST = `npm error code EEXIST
npm error syscall rename
npm error path /root/.npm/_cacache/tmp/6f0d1a2b
npm error dest /root/.npm/_cacache/content-v2/sha512/aa/bb/ccddeeff
npm error EEXIST: file already exists, rename '/root/.npm/_cacache/tmp/6f0d1a2b' -> '/root/.npm/_cacache/content-v2/sha512/aa/bb/ccddeeff'
`

const CACACHE_ENOENT = `npm warn tar TAR_ENTRY_ERROR ENOENT: no such file or directory
npm error code ENOENT
npm error ENOENT: no such file or directory, stat '/root/.npm/_cacache/content-v2/sha512/12/34/5678'
`

describe('обрыв соединения с исполнителем модели', () => {
  it('признаётся инфраструктурным: повтор шага, а не смена модели', () => {
    const failure = classifyLlmTransportFailure('Соединение с исполнителем Codex оборвалось до конца ответа — ход остановлен. Повторите запрос.')
    expect(failure?.kind).toBe('llm_transport')
    expect(failure?.hint).toContain('Повторить тот же шаг')
  })

  it('содержательный отказ модели инфраструктурой не считается', () => {
    expect(classifyLlmTransportFailure('Модель отказалась выполнять запрос')).toBeNull()
    expect(classifyLlmTransportFailure('')).toBeNull()
  })
})

describe('classifyCiInfraFailure', () => {
  it('EEXIST в _cacache → инфраструктурный сбой npm_cache', () => {
    const f = classifyCiInfraFailure({ exitCode: 254, output: CACACHE_EEXIST })
    expect(f?.kind).toBe('npm_cache')
    expect(f?.message).toContain('254')
    expect(f?.hint).toContain('npm cache clean --force')
  })

  it('ENOENT в _cacache → тот же класс (код выхода не важен)', () => {
    expect(classifyCiInfraFailure({ exitCode: 1, output: CACACHE_ENOENT })?.kind).toBe('npm_cache')
    expect(classifyCiInfraFailure({ exitCode: null, output: CACACHE_ENOENT })?.kind).toBe('npm_cache')
  })

  it('ENOSPC → disk_full', () => {
    const f = classifyCiInfraFailure({ exitCode: 1, output: 'Error: ENOSPC: no space left on device, write' })
    expect(f?.kind).toBe('disk_full')
  })

  it('обычная ошибка задачи инфраструктурной не считается', () => {
    expect(classifyCiInfraFailure({ exitCode: 1, output: '1 test failed\nExpected 2 to be 3\n' })).toBeNull()
    // ENOENT сам по себе (нет модуля в проекте) — это к модели, а не к машине.
    expect(classifyCiInfraFailure({ exitCode: 254, output: "Error: ENOENT: no such file or directory, open 'src/missing.ts'" })).toBeNull()
    // EEXIST вне кэша npm — тоже задача (mkdir в скрипте шага).
    expect(classifyCiInfraFailure({ exitCode: 1, output: "mkdir: EEXIST: file already exists, mkdir '/tmp/x'" })).toBeNull()
    expect(classifyCiInfraFailure({ exitCode: 254, output: '' })).toBeNull()
  })

  // Реальный хвост шага «Удалить рабочую папку задачи» в ране CHAT-115: прод
  // пересобрался посреди рана и пересоздал контейнер сервера.
  it('машина отключилась посреди шага → agent_offline', () => {
    const f = classifyCiInfraFailure({ exitCode: null, output: 'Прод-репозиторий на 105aa23\nМашина отключилась во время выполнения команды\n' })
    expect(f?.kind).toBe('agent_offline')
    expect(f?.hint).toContain('пересобирался')
    expect(CI_INFRA_LABEL[f!.kind]).toBe('машина потеряла связь')
  })

  it('машина не в сети → тот же класс', () => {
    expect(classifyCiInfraFailure({ exitCode: null, output: 'Машина не в сети' })?.kind).toBe('agent_offline')
  })

  it('тот же текст с кодом выхода или в середине вывода — ошибка задачи', () => {
    // Скрипт шага дошёл до конца и вернул код: связь была, причина в задаче.
    expect(classifyCiInfraFailure({ exitCode: 1, output: 'Машина не в сети' })).toBeNull()
    // Собственные тесты проекта печатают эти строки как названия кейсов.
    expect(classifyCiInfraFailure({ exitCode: null, output: '× remoteBashMcp > Машина не в сети\n1 test failed\n' })).toBeNull()
  })

  // Реальный хвост стадии `npm run typecheck` в Component QA задачи CHAT-411:
  // development-ран снёс `node_modules`, и tsc не нашёлся ни в одном воркспейсе.
  it('нет бинаря из node_modules (127) → missing_dependencies', () => {
    const output = `> @voicechat/admin-app@0.1.0 typecheck\n> tsc --noEmit -p tsconfig.json\n\nsh: tsc: command not found\nnpm error Lifecycle script \`typecheck\` failed with error:\nnpm error code 127\n`
    const f = classifyCiInfraFailure({ exitCode: 127, output })
    expect(f?.kind).toBe('missing_dependencies')
    expect(f?.hint).toContain('npm ci')
    expect(CI_INFRA_LABEL[f!.kind]).toBe('нет зависимостей в рабочей копии')
  })

  it('код 127 виден только в выводе npm — тот же класс', () => {
    const output = 'sh: vitest: not found\nnpm error code 127\n'
    expect(classifyCiInfraFailure({ exitCode: 1, output })?.kind).toBe('missing_dependencies')
  })

  it('127 без «command not found» и наоборот — ошибка задачи', () => {
    // Скрипт проекта сам вернул 127 — это его логика, а не пустой node_modules.
    expect(classifyCiInfraFailure({ exitCode: 127, output: 'assert failed\n' })).toBeNull()
    // Строку печатает тест проекта, шаг при этом завершился обычной ошибкой.
    expect(classifyCiInfraFailure({ exitCode: 1, output: '× shell > sh: foo: command not found\n1 test failed\n' })).toBeNull()
  })

  it('текст для лога объясняет, почему нет авто-фикса', () => {
    const text = formatCiInfraFailure(classifyCiInfraFailure({ exitCode: 254, output: CACACHE_EEXIST })!)
    expect(text).toContain('Что делать:')
    expect(text).toContain('Авто-фикс не запускаю')
  })
})

describe('grouped test pipeline coordinator', () => {
  const configs = (): TestGroupConfig[] => [
    { id: 'typecheck', name: 'Typecheck', kind: 'typecheck', command: 'npm run typecheck', commandVersion: 1, position: 1, required: true },
    { id: 'server', name: 'Server', kind: 'server', command: 'npm run test:server', commandVersion: 1, position: 2, required: true },
    { id: 'playwright', name: 'Playwright', kind: 'playwright_smoke', command: 'npx playwright test', commandVersion: 1, position: 3, required: false }
  ]
  const input = (groups = configs()) => ({
    id: 'test-1', projectId: 'p1', taskId: 't1', branch: 'feature/t1', commitSha: 'abcdef1',
    workspace: '/work/t1', agentId: 'mac', previewId: 'preview-1', analysisModel: 'gpt-5.4',
    triggeredBy: 'owner', attempt: 1, groups
  })

  it('выполняет группы строго последовательно и сохраняет потоковый прогресс', async () => {
    const active: string[] = []
    let maxActive = 0
    const saved: TestRun[] = []
    const coordinator = createTestPipelineCoordinator({
      store: { save: (run) => { saved.push(run) }, audit: () => undefined },
      preview: { ensure: async ({ commitSha }) => ({ baseUrl: 'https://preview', previewCommitSha: commitSha, testData: 'seed-1' }) },
      executor: {
        execute: async ({ group, log, progress }) => {
          active.push(group.id)
          maxActive = Math.max(maxActive, active.length)
          progress({ currentSuite: 'suite', currentTest: 'test', progress: 50, counters: { tests: 2, passed: 1 } })
          log('stdout', 'token=***')
          active.pop()
          return { exitCode: 0, counters: { tests: 2, passed: 2 } }
        }
      },
      redact: (text) => text.replace(/token=\S+/, 'token=[MASKED]')
    })
    coordinator.create(input())
    const run = await coordinator.start('test-1')
    expect(run.status).toBe('passed')
    expect(run.groups.map((group) => group.status)).toEqual(['passed', 'passed', 'passed'])
    expect(run.groups[2].baseUrl).toBe('https://preview')
    expect(run.groups[2].testData).toBe('seed-1')
    expect(run.groups[0].log).toContain('[MASKED]')
    expect(maxActive).toBe(1)
    expect(saved.at(-1)?.status).toBe('passed')
  })

  it('останавливается на первом обязательном падении и не запускает хвост', async () => {
    const executed: string[] = []
    const coordinator = createTestPipelineCoordinator({
      store: { save: () => undefined, audit: () => undefined },
      executor: { execute: async ({ group }) => {
        executed.push(group.configId)
        return { exitCode: group.configId === 'server' ? 1 : 0 }
      }}
    })
    coordinator.create(input())
    const run = await coordinator.start('test-1')
    expect(executed).toEqual(['typecheck', 'server'])
    expect(run.status).toBe('failed')
    expect(run.groups.map((group) => [group.status, group.skipReason])).toEqual([
      ['passed', null], ['failed', null], ['skipped', 'blocked_by_failure']
    ])
  })

  it('классифицирует сбой preview как инфраструктурный и сохраняет его отдельно', async () => {
    const coordinator = createTestPipelineCoordinator({
      store: { save: () => undefined, audit: () => undefined },
      preview: { ensure: async () => { throw new Error('health-check timeout') } },
      executor: { execute: async () => ({ exitCode: 0 }) }
    })
    coordinator.create(input([configs()[2]]))
    const run = await coordinator.start('test-1')
    expect(run.status).toBe('failed')
    expect(run.groups[0].failures[0]).toMatchObject({ kind: 'infrastructure', message: 'health-check timeout' })
  })

  it('не позволяет участнику или модели пропустить Playwright', async () => {
    const coordinator = createTestPipelineCoordinator({
      store: { save: () => undefined, audit: () => undefined },
      executor: { execute: async () => ({ exitCode: 0 }) }
    })
    coordinator.create(input())
    await expect(coordinator.markNotApplicable('test-1', 'playwright', 'member', {
      reason: 'нет UI', alternativeVerification: 'contract', decidedBy: 'member'
    })).rejects.toThrow('Недостаточно прав')
    const run = await coordinator.markNotApplicable('test-1', 'playwright', 'tester', {
      reason: 'нет UI', alternativeVerification: 'contract', decidedBy: 'tester'
    })
    expect(run.groups[2].notApplicable).toMatchObject({ commitSha: 'abcdef1', decidedBy: 'tester' })
  })

  it('точечный повтор не меняет статус полного pipeline', async () => {
    const coordinator = createTestPipelineCoordinator({
      store: { save: () => undefined, audit: () => undefined },
      executor: {
        execute: async () => ({ exitCode: 0 }),
        executeTargeted: async (_ctx, command) => ({ exitCode: command.includes('one.test') ? 0 : 1 })
      }
    })
    coordinator.create(input())
    const before = coordinator.get('test-1')
    expect((await coordinator.targeted('test-1', 'server', 'vitest one.test.ts')).exitCode).toBe(0)
    expect(coordinator.get('test-1')?.status).toBe(before?.status)
  })
})

describe('test fix cycle coordinator', () => {
  const make = (kind: 'product' | 'infrastructure' = 'product') => {
    const run: TestRun = {
      id: 'run-1', projectId: 'p1', taskId: 't1', branch: 'feature/t1', commitSha: 'abcdef1',
      workspace: '/work/t1', agentId: 'mac', previewId: null, previewCommitSha: null,
      analysisModel: 'gpt', triggeredBy: 'owner', attempt: 1, previousRunId: null,
      status: 'failed', startedAt: 1, finishedAt: 2, durationMs: 1, currentGroupId: null,
      groups: []
    }
    const group = {
      id: 'group-1', testRunId: run.id, configId: 'server', name: 'Server', kind: 'server' as const,
      command: 'npx vitest src/a.test.ts', commandVersion: 1, position: 1, required: true,
      status: 'failed' as const, commitSha: run.commitSha, startedAt: 1, finishedAt: 2,
      durationMs: 1, exitCode: kind === 'product' ? 1 : null,
      counters: { suites: 1, tests: 1, passed: 0, failed: 1, skipped: 0 },
      currentSuite: 'suite', currentTest: 'test', progress: 100, log: kind === 'product' ? '1 test failed Expected 1 to be 2' : 'ENOSPC no space left',
      failures: [{
        kind, packageName: 'server', runner: 'vitest', file: 'src/a.test.ts', suite: 'suite',
        testName: 'test', message: kind === 'product' ? 'Expected 1 to be 2' : 'ENOSPC',
        stack: null, expected: '2', actual: '1', logExcerpt: null, tracePath: null,
        screenshotPath: null, retryCommand: 'npx vitest src/a.test.ts'
      }],
      artifacts: [], skipReason: null, notApplicable: null, browserProject: null,
      baseUrl: null, testData: null
    }
    run.groups = [group]
    return { run, failedGroup: group }
  }

  it('атомарно создаёт ровно один цикл и один раз расходует попытку', () => {
    let state: import('@voicechat/shared').TestFixTaskState | null = null
    let cycle: import('@voicechat/shared').TestFixCycle | null = null
    const moves: string[] = []
    const coordinator = createTestFixCycleCoordinator({ store: {
      transaction: (_taskId, callback) => callback(),
      getTaskState: () => state,
      getByFailure: (runId, groupId) => cycle?.testRunId === runId && cycle.failedGroupId === groupId ? cycle : null,
      saveTaskState: (value) => { state = value },
      saveCycle: (value) => { cycle = value },
      moveTask: (_taskId, semantic) => { moves.push(semantic) },
      audit: () => undefined
    }})
    const input = { id: 'fix-1', ...make(), projectLimit: 10, llm: { llmEngineId: 'e1', provider: 'codex' as const, model: 'gpt-5.4' } }
    const created = coordinator.begin(input)
    expect(created.kind).toBe('created')
    expect(coordinator.begin(input).kind).toBe('duplicate')
    expect(created.kind === 'created' ? created.cycle.attemptNo : 0).toBe(1)
    expect(moves).toEqual(['development'])
    expect(cycle).toMatchObject({ attemptNo: 1, effectiveLimit: 10, sourceCommitSha: 'abcdef1' })
  })

  it('лимит 0 сразу переводит в decision_required без fix-run', () => {
    const moves: string[] = []
    const coordinator = createTestFixCycleCoordinator({ store: {
      transaction: (_taskId, callback) => callback(), getTaskState: () => null,
      getByFailure: () => null, saveTaskState: () => undefined, saveCycle: () => { throw new Error('не должен создаваться') },
      moveTask: (_taskId, semantic) => { moves.push(semantic) }, audit: () => undefined
    }})
    expect(coordinator.begin({ id: 'fix-1', ...make(), projectLimit: 0, llm: { llmEngineId: null, provider: 'claude', model: 'opus' } })).toEqual({
      kind: 'limit_exhausted', usedAttempts: 0, effectiveLimit: 0
    })
    expect(moves).toEqual(['decision_required'])
  })

  it('инфраструктура не расходует попытку и не двигает карточку', () => {
    let writes = 0
    const coordinator = createTestFixCycleCoordinator({ store: {
      transaction: (_taskId, callback) => callback(), getTaskState: () => null, getByFailure: () => null,
      saveTaskState: () => { writes++ }, saveCycle: () => { writes++ }, moveTask: () => { writes++ }, audit: () => undefined
    }})
    expect(coordinator.begin({ id: 'fix-1', ...make('infrastructure'), projectLimit: 10, llm: { llmEngineId: null, provider: 'claude', model: 'opus' } })).toEqual({
      kind: 'not_product', classification: 'infrastructure_failure'
    })
    expect(writes).toBe(0)
  })
})
