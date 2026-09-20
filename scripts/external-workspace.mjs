// Run the complete upstream workspace check, preserving its own configuration.
import { createRequire } from 'node:module'
import { readFileSync, cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const cwd = process.cwd()
const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
const external = pkg.sislexaExternal
if (!external) throw new Error('Not an external workspace adapter')
const require = createRequire(join(cwd, 'package.json'))
const root = dirname(require.resolve(external.package + '/package.json'))
const source = JSON.parse(readFileSync(join(root, 'release-source.json'), 'utf8'))
if (source.commit !== external.commit || source.version !== external.version || source.repository !== external.repository)
  throw new Error('External archive provenance does not match the adapter')
const workspace = resolve(root, external.workspace)
if (!workspace.startsWith(root + '/')) throw new Error('Invalid external workspace path')
const script = process.argv[2]
const result = spawnSync('npm', ['--prefix', workspace, 'run', script, '--', ...process.argv.slice(3)], { stdio: 'inherit', env: script === 'build' ? { ...process.env, VC_APPLICATION_VERSION: external.version, VC_APPLICATION_COMMIT: external.commit, VC_RELEASE_COMMIT: external.commit } : process.env })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
if (script === 'build' && existsSync(join(workspace, 'dist'))) {
  rmSync(join(cwd, 'dist'), { recursive: true, force: true })
  cpSync(join(workspace, 'dist'), join(cwd, 'dist'), { recursive: true })
}
