import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { REST, TEST_PLAN_BUILDS, type TestPlanResponse } from '@voicechat/shared'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { signToken } from '@sislexa/identity/server/users/accounts'
import { loadTestPlan } from './testPlan.js'

const SECRET = 'test-secret'

describe('browser test plan files', () => {
  it('every library file in docs/test-plan is valid and ids are unique across libraries', () => {
    const libraries = loadTestPlan()
    expect(libraries.length).toBeGreaterThan(5)
    const ids = libraries.flatMap(library => library.checks.map(check => check.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const build of TEST_PLAN_BUILDS) expect(libraries.some(l => l.checks.some(c => c.builds.includes(build)))).toBe(true)
    expect(libraries[0]!.id).toBe('core-ui')
  })

  it('names the file and the field of an invalid check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-plan-'))
    writeFileSync(join(dir, 'broken.json'), JSON.stringify({ id: 'broken', title: 'B', checks: [
      { id: 'broken.a.b', title: 'x', steps: ['s'], expected: 'e', role: 'robot', builds: ['minimal'], needsModel: false, priority: 'smoke' }] }))
    expect(() => loadTestPlan(dir)).toThrow(/broken\.json: broken\.checks\[0\]\.role/)
  })
})

describe('GET admin test plan', () => {
  let app: FastifyInstance
  beforeEach(async () => {
    const db = new VoiceChatDb(':memory:')
    await db.identity.createUser('bob', '', 'developer')
    app = await buildServer({ config: loadConfig({ PORT: '0', VC_DATA_DIR: join(tmpdir(), `vc-test-plan-${Date.now()}`) }), db, sessionSecret: SECRET })
  })
  afterEach(async () => { await app.close() })

  it('serves the plan to admins only', async () => {
    const asAdmin = await app.inject({ method: 'GET', url: REST.adminTestPlan, headers: { authorization: `Bearer ${signToken({ name: 'admin', role: 'admin' }, SECRET)}` } })
    expect(asAdmin.statusCode).toBe(200)
    const body = asAdmin.json() as TestPlanResponse
    expect(TEST_PLAN_BUILDS).toContain(body.defaultBuild)
    expect(body.libraries.find(l => l.id === 'chat')?.checks.length).toBeGreaterThan(5)
    const asUser = await app.inject({ method: 'GET', url: REST.adminTestPlan, headers: { authorization: `Bearer ${signToken({ name: 'bob', role: 'developer' }, SECRET)}` } })
    expect(asUser.statusCode).toBe(403)
  })
})
