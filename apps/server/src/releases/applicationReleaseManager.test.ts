import { afterEach, expect, it, vi } from 'vitest'
import { VoiceChatDb } from '../db/database.js'
import {
  ApplicationReleaseManager,
  applicationTargetFingerprint,
  applicationPrepareCommand,
  validateApplicationReleaseInput,
  type ApplicationDeployTarget,
  type ApplicationReleaseRuntime
} from './applicationReleaseManager.js'
import type {
  ApplicationReleaseInput,
  ApplicationReleaseManifest
} from '@voicechat/shared'
const requires = [
  {
    applicationId: 'core',
    minVersion: '1.0.0',
    maxVersionExclusive: '2.0.0',
    minApiVersion: '1.0.0',
    maxApiVersionExclusive: '2.0.0'
  }
]
const input: ApplicationReleaseInput = {
  applicationId: 'make',
  version: '1.1.0',
  image: 'registry.test/make',
  baseBranch: 'main',
  requires
}
const manifest = (
  id = 'make',
  version = '1.1.0'
): ApplicationReleaseManifest => ({
  schemaVersion: 1,
  applicationId: id,
  version,
  apiVersion: '1.0.0',
  commit: 'a'.repeat(40),
  dataVersion: '1.0.0',
  requires: id === 'make' ? requires : [],
  capabilities: [],
  artifacts: [
    {
      service: id === 'core' ? 'voicechat' : id,
      kind: 'oci',
      reference: 'registry.test/' + id + '@sha256:' + 'b'.repeat(64)
    }
  ]
})
const databases: VoiceChatDb[] = []
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close()
})
async function setup() {
  const db = new VoiceChatDb(':memory:')
  databases.push(db)
  await db.ready
  await db.identity.createUser('owner', '', 'developer')
  const projectId = (await db.projects.createProject('owner', { name: 'test' }))
    .id
  const target: ApplicationDeployTarget = {
    projectId,
    agentId: 'agent',
    path: '/tmp/release source',
    gitUrl: 'ssh://git.test/project',
    baseBranch: 'main',
    testCommand: 'legacy-must-not-run',
    prepareCheckout: false,
    configPath: '/tmp/staging/applications.json'
  }
  const runtime: ApplicationReleaseRuntime = {
    prepare: vi.fn(async () => ({
      manifest: manifest(),
      log: 'app gate passed'
    })),
    execute: vi.fn(async () => ({
      environment: null,
      status: 'uncertain' as const,
      log: 'offline'
    }))
  }
  return {
    db,
    projectId,
    target,
    runtime,
    manager: new ApplicationReleaseManager(db, runtime)
  }
}
it('готовит компонентную ветку, точный worktree и матрицу опубликованного digest', () => {
  const target = {
    projectId: 'p',
    agentId: 'a',
    path: '/tmp/a; echo bad',
    gitUrl: 'repo',
    baseBranch: 'main',
    testCommand: 'legacy-must-not-run',
    prepareCheckout: false
  }
  const command = applicationPrepareCommand(target, input, 'request-123')
  expect(command).toContain("cd '/tmp/a; echo bad'")
  expect(command).toContain("npm run gate:app -- 'make'")
  expect(command).toContain('application-compatibility.mjs --manifest')
  expect(command).toContain('git worktree add --detach')
  expect(command).toContain('HEAD:refs/heads/release/make/1.1.0')
  expect(command).not.toContain('legacy-must-not-run')
  expect(command).not.toContain('docker compose up')
  for (const baseBranch of [
    'main; touch x',
    '../main',
    '--upload-pack=x',
    'main.lock'
  ])
    expect(() =>
      validateApplicationReleaseInput({ ...input, baseBranch })
    ).toThrow()
  expect(() =>
    validateApplicationReleaseInput({ ...input, requires: [] })
  ).toThrow(/core/)
})
it('повтор подготовки не запускает второй build', async () => {
  const { db, projectId, target, runtime, manager } = await setup()
  const first = await manager.prepare('owner', target, input)
  const second = await manager.prepare('owner', target, input)
  expect(second.id).toBe(first.id)
  await vi.waitFor(async () =>
    expect(
      (
        await db.releases.applicationReleaseOverview(
          'owner',
          projectId,
          'staging'
        )
      ).releases[0].status
    ).toBe('ready')
  )
  expect(runtime.prepare).toHaveBeenCalledTimes(1)
})
it('неудачная матрица не даёт готовый выпуск', async () => {
  const { db, projectId, target, runtime, manager } = await setup()
  runtime.prepare = vi.fn(async () => {
    throw new Error('minimum core contract failed')
  })
  await manager.prepare('owner', target, input)
  await vi.waitFor(async () => {
    const release = (
      await db.releases.applicationReleaseOverview(
        'owner',
        projectId,
        'staging'
      )
    ).releases[0]
    expect(release.status).toBe('failed')
    expect(release.manifest).toBeNull()
    expect(release.log).toContain('minimum core contract failed')
  })
})
it('рестарт завершает оборванную подготовку без повторной публикации образа', async () => {
  const { db, projectId, runtime, manager } = await setup()
  await db.releases.createApplicationRelease('owner', projectId, input)
  await manager.reconcile(async () => null)
  expect(
    (
      await db.releases.applicationReleaseOverview(
        'owner',
        projectId,
        'staging'
      )
    ).releases[0].status
  ).toBe('failed')
  expect(runtime.prepare).not.toHaveBeenCalled()
})
it('рестарт deploy только сверяет артефакты, offline сохраняет блокировку', async () => {
  const { db, projectId, target, runtime, manager } = await setup()
  const prepared = await db.releases.createApplicationRelease(
    'owner',
    projectId,
    input
  )
  await db.releases.finishApplicationRelease(prepared.record.id, manifest(), '')
  await db.releases.observeApplicationEnvironment(
    'owner',
    projectId,
    'staging',
    {
      schemaVersion: 1,
      revision: 0,
      applications: [
        { manifest: manifest('core', '1.0.0'), healthy: true, installedAt: 1 }
      ]
    },
    0
  )
  const { record } = await db.releases.beginApplicationDeployment(
    'owner',
    projectId,
    'staging',
    {
      requestId: 'request-123',
      expectedRevision: 1,
      releaseIds: [prepared.record.id]
    },
    applicationTargetFingerprint(target)
  )
  await manager.reconcile(async () => target)
  expect(runtime.execute).toHaveBeenCalledWith(
    target,
    expect.objectContaining({ mode: 'reconcile', id: record.id })
  )
  expect(
    (
      await db.releases.applicationReleaseOverview(
        'owner',
        projectId,
        'staging'
      )
    ).activeDeploymentId
  ).toBe(record.id)
})
it('смена машины после рестарта не переносит незавершённый deploy на другую площадку', async () => {
  const { db, projectId, target, runtime, manager } = await setup()
  const prepared = await db.releases.createApplicationRelease(
    'owner',
    projectId,
    input
  )
  await db.releases.finishApplicationRelease(prepared.record.id, manifest(), '')
  await db.releases.observeApplicationEnvironment(
    'owner',
    projectId,
    'staging',
    {
      schemaVersion: 1,
      revision: 0,
      applications: [
        { manifest: manifest('core', '1.0.0'), healthy: true, installedAt: 1 }
      ]
    },
    0
  )
  const { record } = await db.releases.beginApplicationDeployment(
    'owner',
    projectId,
    'staging',
    {
      requestId: 'request-changed',
      expectedRevision: 1,
      releaseIds: [prepared.record.id]
    },
    applicationTargetFingerprint(target)
  )
  await manager.reconcile(async () => ({
    ...target,
    agentId: 'another-machine'
  }))
  expect(runtime.execute).not.toHaveBeenCalled()
  const overview = await db.releases.applicationReleaseOverview(
    'owner',
    projectId,
    'staging'
  )
  expect(overview.activeDeploymentId).toBe(record.id)
  expect(overview.deployments[0].log).toContain('Площадка deploy изменилась')
})
