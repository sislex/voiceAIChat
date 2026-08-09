import { describe, expect, it } from 'vitest'
import { CI_INFRA_LABEL, classifyCiInfraFailure, formatCiInfraFailure } from './infraErrors.js'
import { createTestPipelineCoordinator } from './types.js'
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
