// Read-only preflight. An inventory is not host/transport acceptance.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const { satisfies } = createRequire(import.meta.url)('semver')

export const requiredOwners = [
  '@sislexa/make', '@voicechat/make-contracts',
  '@sislexa/web-reader', '@voicechat/web-reader-contracts',
  '@sislexa/playwright-reader', '@voicechat/playwright-reader-contracts',
  '@voicechat/browser-contracts', '@sislexa/core-ui', '@sislexa/desktop',
]
export function archiveJson(file, member) {
  return JSON.parse(execFileSync('tar', ['-xOf', file, 'package/' + member], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }))
}
export function inspectArtifacts(directory, inventory) {
  if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.artifacts)) throw Error('Invalid artifact inventory')
  const seen = new Set()
  const artifacts = inventory.artifacts.map(row => {
    if (!/^[a-z0-9][a-z0-9.-]*\.tgz$/.test(row.filename) || !/^[a-f0-9]{64}$/.test(row.sha256)) throw Error('Invalid artifact path or hash')
    const file = join(directory, row.filename)
    if (!lstatSync(file).isFile() || realpathSync(file) !== resolve(file)) throw Error('Unsafe artifact file')
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== row.sha256) throw Error('Artifact checksum mismatch: ' + row.filename)
    const pkg = archiveJson(file, 'package.json')
    const source = archiveJson(file, 'release-source.json')
    if (!requiredOwners.includes(pkg.name) || seen.has(pkg.name)) throw Error('Unexpected or duplicate owner: ' + pkg.name)
    seen.add(pkg.name)
    if (pkg.name !== row.name || pkg.version !== row.version || source.version !== row.version ||
        source.commit !== row.commit || source.repository !== row.repository ||
        !/^[a-f0-9]{40}$/.test(source.commit) || source.dirty === true) throw Error('Artifact provenance mismatch: ' + row.filename)
    return { ...row, peers: pkg.peerDependencies ?? {}, optionalPeers: pkg.peerDependenciesMeta ?? {}, source }
  })
  if (requiredOwners.some(name => !seen.has(name))) throw Error('Incomplete owner artifact set')
  const ui = artifacts.find(row => row.name === '@sislexa/core-ui')
  const desktop = artifacts.find(row => row.name === '@sislexa/desktop')
  if (desktop.source.dependencies?.coreUi?.commit !== ui.commit ||
      desktop.source.dependencies?.coreUi?.version !== ui.version) throw Error('Desktop renderer differs from Core UI')
  return artifacts
}
export function peerBlockers(artifacts, available) {
  const versions = { ...available, ...Object.fromEntries(artifacts.map(row => [row.name, row.version])) }
  const blockers = []
  for (const owner of artifacts) for (const [name, range] of Object.entries(owner.peers)) {
    // Public owner dependencies must be supplied explicitly, never fetched implicitly.
    if (!/^@(sislexa|voicechat)\//.test(name)) continue
    const actual = versions[name] ?? null
    if (!actual && owner.optionalPeers?.[name]?.optional) continue
    if (!actual || !satisfies(actual, range)) blockers.push({ owner: owner.name, dependency: name, required: range, actual })
  }
  return blockers
}
export function availableVersions(root) {
  const result = {}
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (spec.startsWith('file:vendor/')) result[name] = archiveJson(join(root, spec.slice(5)), 'package.json').version
  }
  // Actual workspace manifests take precedence over stale lockfile workspace records.
  for (const entry of readdirSync(join(root, 'packages'))) {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', entry, 'package.json'), 'utf8'))
    result[manifest.name] = manifest.version
  }
  return result
}
export function main(args = process.argv.slice(2)) {
  const root = resolve(import.meta.dirname, '..')
  const directory = args[0] ?? (process.env.DELIVERY_ATTEMPT_ROOT && join(process.env.DELIVERY_ATTEMPT_ROOT, 'dependencies/s2-artifacts'))
  if (!directory) throw Error('Supply the assigned artifact directory')
  const inventory = JSON.parse(readFileSync(join(root, 'docs/u10-owner-inputs.json'), 'utf8'))
  const artifacts = inspectArtifacts(resolve(directory), inventory)
  const blockers = peerBlockers(artifacts, availableVersions(root))
  console.log(JSON.stringify({
    schemaVersion: 1, task: 'U10', status: blockers.length ? 'blocked' : 'preflight-passed',
    artifacts: artifacts.map(({ peers, optionalPeers, source, ...row }) => row),
    blockers, acceptance: 'not-run',
  }, null, 2))
  if (blockers.length) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
