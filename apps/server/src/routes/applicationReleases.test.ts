import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import { REST } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { registerApplicationReleaseRoutes } from './applicationReleases.js'
import { ApplicationReleaseManager } from '../releases/applicationReleaseManager.js'
import { ReleaseManager } from '../releases/releaseManager.js'
import { ManagedEnvironmentResolver } from '../releases/managedEnvironmentResolver.js'
const close: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of close.splice(0)) await cleanup()
})
async function setup() {
  const db = new VoiceChatDb(':memory:')
  await db.ready
  for (const user of ['owner', 'member', 'stranger'])
    await db.identity.createUser(user, '', 'developer')
  const project = await db.projects.createProject('owner', {
    name: 'release routes'
  })
  await db.projects.addMember('owner', project.id, 'member')
  const app = Fastify()
  app.decorateRequest('user', null)
  app.addHook('preHandler', async (req) => {
    req.user = {
      name: String(req.headers['x-test-user'] ?? 'owner'),
      role: 'developer'
    }
  })
  const runtime = {
    prepare: vi.fn(async () => {
      throw new Error('unexpected build')
    }),
    execute: vi.fn(async () => {
      throw new Error('unexpected deploy')
    })
  }
  const manager = new ApplicationReleaseManager(db, runtime),
    legacy = new ReleaseManager(db, {
      exec: vi.fn(async () => ({ exitCode: 0, output: '' })),
      prepareKnowledgeBase: async () => {},
      isOnline: () => true
    })
  registerApplicationReleaseRoutes(
    app,
    db,
    manager,
    legacy,
    new ManagedEnvironmentResolver(db, legacy)
  )
  await app.ready()
  close.push(async () => {
    await app.close()
    await db.close()
  })
  return { app, db, projectId: project.id, runtime }
}
it('REST-контракт каталога и истории доступен участнику, чужой проект скрыт', async () => {
  const { app, projectId } = await setup()
  const catalog = await app.inject({
    url: REST.projectApplicationCatalog(projectId),
    headers: { 'x-test-user': 'member' }
  })
  expect(catalog.statusCode).toBe(200)
  expect(catalog.json()).toContainEqual(expect.objectContaining({ id: 'make' }))
  const overview = await app.inject(
    REST.projectApplicationEnvironment(projectId, 'staging')
  )
  expect(overview.json()).toMatchObject({
    environment: { schemaVersion: 1, revision: 0 },
    releases: [],
    deployments: []
  })
  expect(
    (
      await app.inject({
        url: REST.projectApplicationCatalog(projectId),
        headers: { 'x-test-user': 'stranger' }
      })
    ).statusCode
  ).toBe(404)
})
it('участник не может готовить, сверять, выкладывать и снимать блокировку', async () => {
  const { app, projectId, runtime } = await setup()
  const env = REST.projectApplicationEnvironment(projectId, 'production')
  for (const url of [
    REST.projectApplicationReleases(projectId),
    env + '/observe',
    env + '/deploy',
    env + '/reconcile'
  ])
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { 'x-test-user': 'member' },
          payload: { expectedRevision: 0 }
        })
      ).statusCode
    ).toBe(403)
  expect(runtime.prepare).not.toHaveBeenCalled()
  expect(runtime.execute).not.toHaveBeenCalled()
})
it('неизвестное окружение отвергается, staging не подменяется production-целью', async () => {
  const { app, projectId, runtime } = await setup()
  expect(
    (
      await app.inject(
        `/api/projects/${projectId}/application-releases/environments/other`
      )
    ).statusCode
  ).toBe(400)
  const response = await app.inject({
    method: 'POST',
    url: REST.projectApplicationEnvironment(projectId, 'staging') + '/observe',
    payload: { expectedRevision: 0 }
  })
  expect(response.statusCode).toBe(400)
  expect(response.json().error).toContain('отдельное окружение')
  expect(runtime.execute).not.toHaveBeenCalled()
})
