// Transitional adapters validate consumer inputs; owner suites run in owner CI.
import { createRequire } from 'node:module'
import { readFileSync, cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

export function validateExternalWorkspace(cwd = process.cwd()) {
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const external = pkg.sislexaExternal
  if (!external) throw new Error('Not an external workspace adapter')
  const require = createRequire(join(cwd, 'package.json'))
  const root = dirname(require.resolve(external.package + '/package.json'))
  const source = JSON.parse(readFileSync(join(root, 'release-source.json'), 'utf8'))
  const installed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (source.commit !== external.commit || source.version !== external.version || source.repository !== external.repository || installed.version !== external.version)
    throw new Error('External archive provenance does not match the adapter')
  const workspace = resolve(root, external.workspace)
  if (workspace !== root && !workspace.startsWith(root + '/')) throw new Error('Invalid external workspace path')
  if (!existsSync(join(workspace, 'package.json'))) throw new Error('External workspace manifest is missing')
  return { external, workspace }
}

export function runExternalWorkspace(script, args = [], cwd = process.cwd()) {
  const { external, workspace } = validateExternalWorkspace(cwd)
  if (script === 'verify') {
    console.log(`[consumer] ${external.package}@${external.version}: provenance verified; owner checks: ${external.repository}`)
    return
  }
  if (!['build', 'start', 'dev'].includes(script))
    throw new Error(`Run ${script} in the owner repository: ${external.repository}`)
  const result = spawnSync('npm', ['--prefix', workspace, 'run', script, '--', ...args], { stdio: 'inherit', env: script === 'build' ? { ...process.env, VC_APPLICATION_VERSION: external.version, VC_APPLICATION_COMMIT: external.commit, VC_RELEASE_COMMIT: external.commit } : process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`External ${script} failed with exit code ${result.status}`)
  if (script === 'build' && existsSync(join(workspace, 'dist'))) {
    rmSync(join(cwd, 'dist'), { recursive: true, force: true })
    cpSync(join(workspace, 'dist'), join(cwd, 'dist'), { recursive: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runExternalWorkspace(process.argv[2], process.argv.slice(3))
