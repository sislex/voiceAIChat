// Acceptance evidence belongs to these exact bytes, including uncommitted delivery patches.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { root, digest, verifyInstalledSnapshot } from './shared-chat-artifacts.mjs'

const snapshotBytes = readFileSync(join(root, 'dependency-snapshots.json'))
const snapshot = JSON.parse(snapshotBytes)
const directory = process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'artifacts', 'shared-chat') : join(root, 'artifacts/shared-chat')
mkdirSync(directory, { recursive: true })
const evidence = { schemaVersion: 1, snapshotSha256: digest(snapshotBytes), status: 'running', commissioning: 'not-performed', packages: snapshot.packages.map(({ name, version, sha256, commit }) => ({ name, version, sha256, commit })), checks: [] }
const save = () => writeFileSync(join(directory, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n')
try {
  await verifyInstalledSnapshot(snapshot)
  const inputs = []
  const walk = path => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules') continue
      const file = path + '/' + entry.name
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile()) inputs.push([file, digest(readFileSync(join(root, file)))])
    }
  }
  for (const path of ['apps/server/src', 'packages/shared/src', 'packages/component-runtime/src', 'scripts']) walk(path)
  inputs.push(['package-lock.json', digest(readFileSync(join(root, 'package-lock.json')))])
  evidence.coreInputsSha256 = digest(JSON.stringify(inputs))
  save()
  for (const file of ['scripts/shared-chat-artifacts.test.mjs', 'scripts/shared-chat-acceptance.test.mjs']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', file], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
    const log = file.split('/').at(-1) + '.log'
    writeFileSync(join(directory, log), (result.stdout ?? '') + (result.stderr ?? ''), { mode: 0o600 })
    evidence.checks.push({ file, exitCode: result.status, signal: result.signal, errorCode: result.error?.code ?? null, log })
    save()
    if (result.error || result.status !== 0) throw Error('Shared chat acceptance failed: ' + file)
  }
  evidence.status = 'passed'
} catch (error) {
  evidence.status = 'failed'; evidence.error = error.message; process.exitCode = 1
} finally { save() }
console.log(`[shared-chat] ${evidence.status}; evidence: ${resolve(directory, 'acceptance.json')}`)
