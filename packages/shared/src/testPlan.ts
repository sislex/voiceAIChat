// Browser test plan: manual, click-through checks of every component, grouped by library.
// The plan lives in Core `docs/test-plan/<library>.json`; the admin page in Core UI shows it.

export const TEST_PLAN_BUILDS = ['minimal', 'full'] as const
export type TestPlanBuild = (typeof TEST_PLAN_BUILDS)[number]
export const TEST_PLAN_PRIORITIES = ['smoke', 'core', 'extended'] as const
export type TestPlanPriority = (typeof TEST_PLAN_PRIORITIES)[number]
export const TEST_PLAN_ROLES = ['guest', 'user', 'admin'] as const
export type TestPlanRole = (typeof TEST_PLAN_ROLES)[number]

export interface TestPlanCheck {
  /** Stable id, `<library>.<area>.<name>` in lowercase. */
  id: string
  title: string
  /** Click-through steps as a user performs them. */
  steps: string[]
  expected: string
  role: TestPlanRole
  builds: TestPlanBuild[]
  /** The check spends model turns. */
  needsModel: boolean
  priority: TestPlanPriority
}

export interface TestPlanLibrary {
  /** Module id from `docs/kb/modules.md` (core, core-ui, identity, …). */
  id: string
  title: string
  description?: string
  checks: TestPlanCheck[]
}

export interface TestPlanResponse {
  /** Build the page should filter by default: `minimal` when the deployment has no Make. */
  defaultBuild: TestPlanBuild
  libraries: TestPlanLibrary[]
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/
const LIBRARY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field}: non-empty string required`)
  return value.trim()
}

/** Validates one plan file; throws with the offending field so a broken plan fails its test. */
export function parseTestPlanLibrary(value: unknown): TestPlanLibrary {
  if (!value || typeof value !== 'object') throw new Error('library: object required')
  const raw = value as Record<string, unknown>
  const id = nonEmpty(raw.id, 'id')
  if (!LIBRARY_ID.test(id)) throw new Error(`id: invalid library id ${id}`)
  if (!Array.isArray(raw.checks) || !raw.checks.length) throw new Error(`${id}.checks: non-empty array required`)
  const seen = new Set<string>()
  const checks = raw.checks.map((entry, index): TestPlanCheck => {
    const where = `${id}.checks[${index}]`
    if (!entry || typeof entry !== 'object') throw new Error(`${where}: object required`)
    const c = entry as Record<string, unknown>
    const checkId = nonEmpty(c.id, `${where}.id`)
    if (!ID.test(checkId) || !checkId.startsWith(id + '.')) throw new Error(`${where}.id: must look like ${id}.<area>.<name>`)
    if (seen.has(checkId)) throw new Error(`${where}.id: duplicate ${checkId}`)
    seen.add(checkId)
    if (!Array.isArray(c.steps) || !c.steps.length) throw new Error(`${where}.steps: non-empty array required`)
    const steps = c.steps.map((step, n) => nonEmpty(step, `${where}.steps[${n}]`))
    if (!TEST_PLAN_ROLES.includes(c.role as TestPlanRole)) throw new Error(`${where}.role: one of ${TEST_PLAN_ROLES.join(', ')}`)
    if (!TEST_PLAN_PRIORITIES.includes(c.priority as TestPlanPriority)) throw new Error(`${where}.priority: one of ${TEST_PLAN_PRIORITIES.join(', ')}`)
    if (!Array.isArray(c.builds) || !c.builds.length || c.builds.some(b => !TEST_PLAN_BUILDS.includes(b as TestPlanBuild))) {
      throw new Error(`${where}.builds: non-empty subset of ${TEST_PLAN_BUILDS.join(', ')}`)
    }
    if (typeof c.needsModel !== 'boolean') throw new Error(`${where}.needsModel: boolean required`)
    return {
      id: checkId, title: nonEmpty(c.title, `${where}.title`), steps, expected: nonEmpty(c.expected, `${where}.expected`),
      role: c.role as TestPlanRole, builds: [...new Set(c.builds as TestPlanBuild[])], needsModel: c.needsModel,
      priority: c.priority as TestPlanPriority
    }
  })
  return {
    id, title: nonEmpty(raw.title, `${id}.title`),
    ...(raw.description === undefined ? {} : { description: nonEmpty(raw.description, `${id}.description`) }),
    checks
  }
}
