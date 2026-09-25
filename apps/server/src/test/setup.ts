import { afterEach, expect, vi } from 'vitest'
import { privateDataDir } from './privateDataDir.js'

// These legacy integration suites construct Core with partial env objects.
// Keep their real config loader, but explicitly supply fixture storage. Config
// contract tests must continue to exercise the unchanged production defaults.
const legacyFixtures = [
  '/src/session.test.ts',
  '/src/accountAccess.test.ts',
  '/src/routes/rest.runnerProxy.test.ts',
  '/src/test/legacyConfig.test.ts'
]
const testPath = expect.getState().testPath?.replaceAll('\\', '/') ?? ''
if (legacyFixtures.some(path => testPath.endsWith(path))) {
  const directories: ReturnType<typeof privateDataDir>[] = []
  vi.doMock('../config.js', async () => {
    const actual = await vi.importActual<typeof import('../config.js')>('../config.js')
    return {
      ...actual,
      loadConfig(env: NodeJS.ProcessEnv = process.env) {
        if (env.VC_DATA_DIR !== undefined) return actual.loadConfig(env)
        const directory = privateDataDir('core-legacy-integration-')
        directories.push(directory)
        return actual.loadConfig({ ...env, VC_DATA_DIR: directory.path })
      }
    }
  })
  // Setup hooks are registered before suite hooks; Vitest runs afterEach in
  // reverse order, after the suite has closed its applications and databases.
  afterEach(() => {
    for (const directory of directories.splice(0)) directory.remove()
  })
}
