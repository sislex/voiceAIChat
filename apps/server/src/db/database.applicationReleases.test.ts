import { afterEach, describe, expect, it } from 'vitest'
import { VoiceChatDb } from './database.js'
import type {
  ApplicationReleaseManifest,
  ApplicationEnvironment
} from '@voicechat/shared'
const requirement = {
  applicationId: 'core',
  minVersion: '1.0.0',
  maxVersionExclusive: '2.0.0',
  minApiVersion: '1.0.0',
  maxApiVersionExclusive: '2.0.0'
}
const manifest = (
  id = 'make',
  version = '1.0.0'
): ApplicationReleaseManifest => ({
  schemaVersion: 1,
  applicationId: id,
  version,
  apiVersion: '1.0.0',
  commit: 'a'.repeat(40),
  dataVersion: '1.0.0',
  capabilities: [],
  requires: id === 'make' ? [requirement] : [],
  artifacts: [
    {
      service: id === 'core' ? 'voicechat' : id,
      kind: 'oci',
      reference: `registry.test/${id}@sha256:${(version === '1.0.0' ? 'b' : 'c').repeat(64)}`
    }
  ]
})
const state = (
  ...manifests: ApplicationReleaseManifest[]
): ApplicationEnvironment => ({
  schemaVersion: 1,
  revision: 0,
  applications: manifests.map((manifest) => ({
    manifest,
    healthy: true,
    installedAt: 1
  }))
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
  await db.identity.createUser('stranger', '', 'developer')
  const projectId = (
    await db.projects.createProject('owner', { name: 'Application releases' })
  ).id
  const prepare = async (version = '1.1.0') => {
    const m = manifest('make', version)
    const release = await db.releases.createApplicationRelease(
      'owner',
      projectId,
      {
        applicationId: 'make',
        version,
        image: 'registry.test/make',
        baseBranch: 'main',
        requires: m.requires
      }
    )
    await db.releases.finishApplicationRelease(
      release.record.id,
      m,
      'gate:app make passed'
    )
    return release.record.id
  }
  const observe = async () =>
    db.releases.observeApplicationEnvironment(
      'owner',
      projectId,
      'staging',
      state(manifest('core'), manifest()),
      0
    )
  return { db, projectId, prepare, observe }
}
describe('компонентные релизы и блокировки окружения', () => {
  it('сохраняет legacy-историю отдельно от приложения', async () => {
    const { db, projectId, prepare } = await setup()
    await db.releases.createProjectRelease('owner', projectId, {
      branch: 'release/1.0.0',
      version: '1.0.0',
      sha: 'legacy'
    })
    await prepare()
    expect(
      await db.releases.listProjectReleases('owner', projectId)
    ).toHaveLength(1)
    expect(
      (
        await db.releases.applicationReleaseOverview(
          'owner',
          projectId,
          'staging'
        )
      ).releases
    ).toHaveLength(1)
  })
  it('резервирует версию идемпотентно и не позволяет подменить вход подготовки', async () => {
    const { db, projectId } = await setup()
    const input = {
      applicationId: 'make',
      version: '1.0.0',
      image: 'registry.test/make',
      baseBranch: 'main',
      requires: [requirement]
    }
    const first = await db.releases.createApplicationRelease(
      'owner',
      projectId,
      input
    )
    expect(
      await db.releases.createApplicationRelease('owner', projectId, input)
    ).toEqual({ ...first, created: false })
    await expect(
      db.releases.createApplicationRelease('owner', projectId, {
        ...input,
        baseBranch: 'other'
      })
    ).rejects.toThrow(/зарезервирована/)
    await expect(
      db.releases.finishApplicationRelease(
        first.record.id,
        manifest('make', '1.1.0'),
        ''
      )
    ).rejects.toThrow(/соответствует/)
  })
  it('не даёт постороннему видеть или менять выпуски', async () => {
    const { db, projectId } = await setup()
    await expect(
      db.releases.applicationReleaseOverview('stranger', projectId, 'staging')
    ).rejects.toThrow(/permission/)
    await expect(
      db.releases.observeApplicationEnvironment(
        'stranger',
        projectId,
        'staging',
        state(),
        0
      )
    ).rejects.toThrow(/permission/)
  })
  it('проверяет нижнюю и верхнюю границы перед захватом deploy', async () => {
    for (const version of ['0.9.0', '2.0.0']) {
      const { db, projectId, prepare } = await setup()
      const releaseId = await prepare()
      await db.releases.observeApplicationEnvironment(
        'owner',
        projectId,
        'staging',
        state(manifest('core', version)),
        0
      )
      await expect(
        db.releases.beginApplicationDeployment('owner', projectId, 'staging', {
          requestId: 'request-1',
          expectedRevision: 1,
          releaseIds: [releaseId]
        })
      ).rejects.toThrow(/требуется/)
      expect(
        (
          await db.releases.applicationReleaseOverview(
            'owner',
            projectId,
            'staging'
          )
        ).activeDeploymentId
      ).toBeNull()
    }
  })
  it('повтор запроса возвращает ту же попытку; чужой запрос не обходит durable lock', async () => {
    const { db, projectId, prepare, observe } = await setup()
    await observe()
    const input = {
      requestId: 'request-1',
      expectedRevision: 1,
      releaseIds: [await prepare()]
    }
    const first = await db.releases.beginApplicationDeployment(
      'owner',
      projectId,
      'staging',
      input
    )
    expect(
      await db.releases.beginApplicationDeployment(
        'owner',
        projectId,
        'staging',
        input
      )
    ).toEqual({ ...first, created: false })
    await expect(
      db.releases.beginApplicationDeployment('owner', projectId, 'staging', {
        ...input,
        requestId: 'request-2'
      })
    ).rejects.toThrow(/занято/)
    await expect(
      db.releases.beginApplicationDeployment('owner', projectId, 'staging', {
        ...input,
        releaseIds: []
      })
    ).rejects.toThrow(/Ключ/)
    expect(
      (await db.releases.interruptedApplicationOperations()).deployments[0].id
    ).toBe(first.record.id)
  })
  it('разные площадки и подготовки разных приложений не блокируются', async () => {
    const { db, projectId, prepare, observe } = await setup()
    await observe()
    const releaseId = await prepare()
    await db.releases.observeApplicationEnvironment(
      'owner',
      projectId,
      'production',
      state(manifest('core'), manifest()),
      0
    )
    const results = await Promise.all(
      ['staging', 'production'].map((environment) =>
        db.releases.beginApplicationDeployment(
          'owner',
          projectId,
          environment as 'staging' | 'production',
          {
            requestId: 'request-1',
            expectedRevision: 1,
            releaseIds: [releaseId]
          }
        )
      )
    )
    expect(results.every((result) => result.created)).toBe(true)
  })
  it('uncertain сохраняет блокировку, повторная проверка завершает тот же deploy', async () => {
    const { db, projectId, prepare, observe } = await setup()
    await observe()
    const releaseId = await prepare()
    const { record } = await db.releases.beginApplicationDeployment(
      'owner',
      projectId,
      'staging',
      { requestId: 'request-1', expectedRevision: 1, releaseIds: [releaseId] }
    )
    await db.releases.finishApplicationDeployment(
      record.id,
      'uncertain',
      null,
      'connection lost'
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
    await db.releases.finishApplicationDeployment(
      record.id,
      'released',
      state(manifest('core'), manifest('make', '1.1.0')),
      'verified'
    )
    const overview = await db.releases.applicationReleaseOverview(
      'owner',
      projectId,
      'staging'
    )
    expect(overview.activeDeploymentId).toBeNull()
    expect(overview.environment.revision).toBe(2)
    expect(overview.deployments[0].status).toBe('released')
  })
  it('не принимает другой digest и откатывает только последний выпуск', async () => {
    const { db, projectId, prepare, observe } = await setup()
    await observe()
    const releaseId = await prepare()
    const { record } = await db.releases.beginApplicationDeployment(
      'owner',
      projectId,
      'staging',
      { requestId: 'request-1', expectedRevision: 1, releaseIds: [releaseId] }
    )
    await expect(
      db.releases.finishApplicationDeployment(
        record.id,
        'released',
        state(manifest('core'), manifest()),
        ''
      )
    ).rejects.toThrow(/соответствует/)
    await db.releases.finishApplicationDeployment(
      record.id,
      'released',
      state(manifest('core'), manifest('make', '1.1.0')),
      ''
    )
    const rollback = await db.releases.beginApplicationDeployment(
      'owner',
      projectId,
      'staging',
      {
        requestId: 'rollback-1',
        expectedRevision: 2,
        releaseIds: [],
        rollbackOf: record.id
      }
    )
    expect(rollback.record.releases).toEqual([manifest()])
    expect(rollback.record.rollbackOf).toBe(record.id)
  })
  it('не освобождает lock при непроверенном health failure', async () => {
    const { db, projectId, prepare, observe } = await setup()
    await observe()
    const { record } = await db.releases.beginApplicationDeployment(
      'owner',
      projectId,
      'staging',
      {
        requestId: 'request-1',
        expectedRevision: 1,
        releaseIds: [await prepare()]
      }
    )
    await expect(
      db.releases.finishApplicationDeployment(record.id, 'failed', state(), '')
    ).rejects.toThrow(/восстановлено/)
    await db.releases.finishApplicationDeployment(
      record.id,
      'failed',
      record.previous,
      'rollback passed'
    )
    expect(
      (
        await db.releases.applicationReleaseOverview(
          'owner',
          projectId,
          'staging'
        )
      ).activeDeploymentId
    ).toBeNull()
  })
  it('запрещает неявное изменение схемы данных', async () => {
    const { db, projectId, observe } = await setup()
    await observe()
    const m = { ...manifest('make', '1.1.0'), dataVersion: '2.0.0' }
    const { record } = await db.releases.createApplicationRelease(
      'owner',
      projectId,
      {
        applicationId: 'make',
        version: '1.1.0',
        image: 'registry.test/make',
        baseBranch: 'main',
        requires: m.requires
      }
    )
    await db.releases.finishApplicationRelease(record.id, m, '')
    await expect(
      db.releases.beginApplicationDeployment('owner', projectId, 'staging', {
        requestId: 'request-1',
        expectedRevision: 1,
        releaseIds: [record.id]
      })
    ).rejects.toThrow(/миграции/)
  })
})
it('мигрирует файл старой БД без потери legacy-истории и сохраняет lock при повторном открытии', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs'),
    { tmpdir } = await import('node:os'),
    { join } = await import('node:path'),
    { default: Sqlite } = await import('better-sqlite3')
  const directory = mkdtempSync(join(tmpdir(), 'vc-release-db-')),
    path = join(directory, 'legacy.sqlite')
  let db = new VoiceChatDb(path)
  try {
    await db.ready
    await db.identity.createUser('owner', '', 'developer')
    const projectId = (
      await db.projects.createProject('owner', { name: 'Legacy' })
    ).id
    await db.releases.createProjectRelease('owner', projectId, {
      branch: 'release/1.0.0',
      version: '1.0.0',
      sha: 'legacy'
    })
    await db.close()
    const old = new Sqlite(path)
    old.exec(
      'DROP TABLE application_deployments; DROP TABLE application_environments; DROP TABLE application_releases;'
    )
    old.close()
    db = new VoiceChatDb(path)
    await db.ready
    expect(
      await db.releases.listProjectReleases('owner', projectId)
    ).toHaveLength(1)
    expect(
      (
        await db.releases.applicationReleaseOverview(
          'owner',
          projectId,
          'staging'
        )
      ).releases
    ).toEqual([])
    const { record } = await db.releases.createApplicationRelease(
      'owner',
      projectId,
      {
        applicationId: 'make',
        version: '1.1.0',
        image: 'registry.test/make',
        baseBranch: 'main',
        requires: [requirement]
      }
    )
    await db.releases.finishApplicationRelease(
      record.id,
      manifest('make', '1.1.0'),
      ''
    )
    await db.releases.observeApplicationEnvironment(
      'owner',
      projectId,
      'staging',
      state(manifest('core'), manifest()),
      0
    )
    const attempt = await db.releases.beginApplicationDeployment(
      'owner',
      projectId,
      'staging',
      {
        requestId: 'persistent-request',
        expectedRevision: 1,
        releaseIds: [record.id]
      }
    )
    await db.close()
    db = new VoiceChatDb(path)
    await db.ready
    expect(
      (
        await db.releases.applicationReleaseOverview(
          'owner',
          projectId,
          'staging'
        )
      ).activeDeploymentId
    ).toBe(attempt.record.id)
  } finally {
    await db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
it('общий production deploy и переход к компонентам не обходят блокировки друг друга', async () => {
  const { db, projectId, prepare } = await setup()
  const legacy = await db.releases.createProjectRelease('owner', projectId, { branch: 'release/1.0.0', version: '1.0.0', sha: 'legacy', status: 'ready' })
  const attempt = await db.releases.createProjectRelease('owner', projectId, { branch: legacy.branch, version: legacy.version, sha: legacy.sha, previousReleaseId: legacy.id, status: 'queued' })
  await expect(db.releases.observeApplicationEnvironment('owner', projectId, 'production', state(manifest('core'), manifest()), 0)).rejects.toThrow('общий production deploy')
  const releaseId = await prepare()
  await expect(db.releases.beginApplicationDeployment('owner', projectId, 'production', { requestId: 'parallel-legacy', expectedRevision: 0, releaseIds: [releaseId] })).rejects.toThrow('общий production deploy')
  // Отдельный staging не блокируется production-операцией.
  await db.releases.observeApplicationEnvironment('owner', projectId, 'staging', state(manifest('core'), manifest()), 0)
  await db.releases.setProjectReleaseStatus(attempt.id, 'released', 'owner')
  await db.releases.observeApplicationEnvironment('owner', projectId, 'production', state(manifest('core'), manifest()), 0)
  await expect(db.releases.createProjectRelease('owner', projectId, { branch: legacy.branch, version: legacy.version, sha: legacy.sha, previousReleaseId: legacy.id, status: 'queued' })).rejects.toThrow('управляется выпусками приложений')
})
