// Release Center orchestrates an owner checkout; it never builds extracted source in Core.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APPLICATION_CATALOG, validateCatalogRelease } from '../packages/shared/src/applicationCatalog.ts'
import { applicationReleaseBranch, applicationVersion, parseApplicationReleaseManifest } from '../packages/shared/src/applicationRelease.ts'
import { planCompatibilityMatrix, runCompatibilityCase } from './application-compatibility.mjs'

// These are release entrypoints in owner repositories, not Core workspaces.
export const OWNER_RELEASE_ENTRIES = Object.freeze({
  make: ['apps/make', 'api'],
  'make-ui': ['packages/make-app', 'frontend'],
  'image-studio': ['apps/image-studio', 'api'],
  'image-studio-ui': ['packages/image-studio-app', 'frontend'],
  'playwright-reader': ['apps/playwright-reader', 'api'],
  'playwright-reader-ui': ['packages/playwright-reader-app', 'frontend'],
  'browser-runner': ['apps/browser-runner', 'browser'],
  'web-reader': ['apps/web-reader', 'api'],
  'web-reader-ui': ['packages/web-reader-app', 'frontend'],
  'stt-runner': ['apps/stt-runner', 'stt'],
  'tts-runner': ['apps/tts-runner', 'tts'],
  identity: ['apps/server', ''],
  billing: ['.', '']
})
const json = path => JSON.parse(readFileSync(path, 'utf8'))
export function ownerReleasePlan({ applicationId, version, image, baseBranch }) {
  const app = APPLICATION_CATALOG.find(item => item.id === applicationId)
  const entry = OWNER_RELEASE_ENTRIES[applicationId]
  if (!app?.external || !app.isolation.deploy || !entry) throw new Error('No owner release entrypoint: ' + applicationId)
  if (!applicationVersion(version) || !/^[a-z0-9][a-z0-9._:/-]*$/.test(image ?? '')) throw new Error('Invalid owner version or image')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*(?:\.[a-zA-Z0-9/_-]+)*$/.test(baseBranch ?? '') || baseBranch.includes('..') || baseBranch.endsWith('/') || baseBranch.endsWith('.lock')) throw new Error('Invalid owner branch')
  return { app, repository: app.external.repository, path: entry[0], target: entry[1], branch: applicationReleaseBranch(applicationId, version), version, image, baseBranch }
}
export function ownerSourceRelease(plan, source, commit, requires) {
  const pkg = json(join(source, 'package.json'))
  if (pkg.version !== plan.version) throw new Error(`Owner package version ${pkg.version} does not match ${plan.version}`)
  if (!pkg.scripts?.gate) throw new Error('Owner must provide a full gate')
  const metadata = json(join(source, plan.path, 'release.json'))
  if (metadata.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid owner release provenance')
  const release = { schemaVersion: 1, applicationId: plan.app.id, version: plan.version, commit, apiVersion: metadata.apiVersion, dataVersion: metadata.dataVersion, capabilities: metadata.capabilities, requires }
  validateCatalogRelease(parseApplicationReleaseManifest({ ...release, artifacts: plan.app.services.map(service => ({ kind: 'oci', service, reference: plan.image + '@sha256:' + '0'.repeat(64) })) }))
  return release
}
export function ownerGateCommand(pkg) {
  if (!pkg.scripts?.gate) throw new Error('Owner must provide a full gate')
  return pkg.scripts['gate:release'] ? 'gate:release' : 'gate'
}
export async function prepareOwnerRelease(input, { execute = (command, args, cwd, capture = false) => {
  if (capture) return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.status ?? result.signal}`)
} } = {}) {
  const plan = ownerReleasePlan(input), temporary = mkdtempSync(join(tmpdir(), 'sislexa-owner-release-')), source = join(temporary, 'source')
  try {
    execute('git', ['clone', '--no-checkout', '--', plan.repository, source], temporary)
    execute('git', ['fetch', 'origin', `refs/heads/${plan.baseBranch}`], source)
    const commit = execute('git', ['rev-parse', 'FETCH_HEAD'], source, true)
    execute('git', ['checkout', '--detach', commit], source)
    const release = ownerSourceRelease(plan, source, commit, input.requires)
    const driverPath = join(source, plan.path, 'compatibility.mjs'), matrixPath = join(source, plan.path, 'release-matrix.json')
    if (!existsSync(driverPath)) throw new Error('Owner release requires compatibility.mjs: ' + plan.repository)
    const matrix = existsSync(matrixPath) ? json(matrixPath) : input.requires.some(item => !item.optional) ? null : { schemaVersion: 1, current: {}, environments: [{ name: 'standalone', applications: [] }] }
    // Validate the baseline before spending time on a build or publishing an image.
    const placeholder = { ...release, artifacts: plan.app.services.map(service => ({ kind: 'oci', service, reference: plan.image + '@sha256:' + '0'.repeat(64) })) }
    planCompatibilityMatrix(placeholder, matrix)
    execute('npm', ['ci', '--no-audit', '--no-fund'], source)
    execute('npm', ['run', ownerGateCommand(json(join(source, 'package.json')))], source)
    if (execute('git', ['status', '--porcelain'], source, true)) throw new Error('Owner gate changed tracked release inputs')
    const tag = `${plan.image}:${plan.version}-${commit.slice(0, 12)}`
    execute('docker', ['build', '--platform', 'linux/amd64', ...(plan.target ? ['--target', plan.target] : []), '--build-arg', `APPLICATION_VERSION=${plan.version}`, '--build-arg', `APPLICATION_COMMIT=${commit}`, '--label', `com.voicechat.application=${plan.app.id}`, '--label', `com.voicechat.release=${JSON.stringify(release)}`, '-t', tag, '.'], source)
    const imageInfo = JSON.parse(execute('docker', ['image', 'inspect', tag], source, true))[0]
    const environment = Object.fromEntries(imageInfo.Config.Env.map(value => { const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)] }))
    for (const [key, expected] of Object.entries({ VC_APPLICATION_ID: plan.app.id, VC_APPLICATION_VERSION: plan.version, VC_APPLICATION_COMMIT: commit, VC_APPLICATION_API_VERSION: release.apiVersion, VC_APPLICATION_DATA_VERSION: release.dataVersion }))
      if (environment[key] !== expected) throw new Error(`Owner image metadata mismatch: ${key}`)
    execute('docker', ['push', tag], source)
    const digests = JSON.parse(execute('docker', ['image', 'inspect', tag, '--format', '{{json .RepoDigests}}'], source, true)) ?? []
    const reference = digests.find(value => value.startsWith(plan.image + '@sha256:'))
    if (!reference) throw new Error('Owner image has no published immutable digest')
    const manifest = parseApplicationReleaseManifest({ ...release, artifacts: plan.app.services.map(service => ({ kind: 'oci', service, reference })) })
    for (const row of planCompatibilityMatrix(manifest, matrix)) await runCompatibilityCase(manifest, row, { driverPath })
    if (execute('git', ['rev-parse', 'HEAD'], source, true) !== commit) throw new Error('Owner source changed during preparation')
    execute('git', ['push', `--force-with-lease=refs/heads/${plan.branch}:`, 'origin', `HEAD:refs/heads/${plan.branch}`], source)
    return manifest
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
export async function main(args = process.argv.slice(2)) {
  const value = flag => args[args.indexOf(flag) + 1]
  if (!args.includes('--input') || !args.includes('--output')) throw new Error('Expected --input and --output')
  const result = await prepareOwnerRelease(json(resolve(value('--input'))))
  writeFileSync(resolve(value('--output')), JSON.stringify(result) + '\n')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
