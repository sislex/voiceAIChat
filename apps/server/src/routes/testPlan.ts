// Admin-only browser test plan: click-through checks of every component, one JSON file per
// library in `docs/test-plan`. The files ship with the Core checkout and image, so the page
// always shows the plan of the running release.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { REST, parseTestPlanLibrary, type TestPlanBuild, type TestPlanLibrary, type TestPlanResponse } from '@voicechat/shared'
import { requireAdmin } from '@sislexa/identity/server/users/auth'

export const TEST_PLAN_DIR = resolve(import.meta.dirname, '../../../../docs/test-plan')

/** Shell first, then the minimal build's services, then the optional applications. */
const ORDER = ['core-ui', 'chat', 'identity', 'billing', 'storage', 'core', 'llm-runner', 'make', 'kanban',
  'image-studio', 'web-reader', 'playwright-reader', 'voice', 'analytics']

export function loadTestPlan(directory = TEST_PLAN_DIR): TestPlanLibrary[] {
  const libraries = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => {
    try { return parseTestPlanLibrary(JSON.parse(readFileSync(join(directory, name), 'utf8'))) } catch (error) {
      throw new Error(`docs/test-plan/${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  const rank = (id: string) => { const i = ORDER.indexOf(id); return i < 0 ? ORDER.length : i }
  return libraries.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
}

export function registerTestPlanRoute(app: FastifyInstance, opts: { defaultBuild: TestPlanBuild; directory?: string }): void {
  app.get(REST.adminTestPlan, { preHandler: requireAdmin }, async (): Promise<TestPlanResponse> =>
    ({ defaultBuild: opts.defaultBuild, libraries: loadTestPlan(opts.directory) }))
}
