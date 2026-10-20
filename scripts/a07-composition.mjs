// Artifact preflight only. A successful preflight is not end-to-end acceptance.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { archiveFiles, digest, root } from './shared-chat-artifacts.mjs'
import { ensureVendorArchive, isVendorRef } from './vendor-store.mjs'

export const requiredSources = Object.freeze({
  '@sislexa/identity': ['sislex/identity', 'b71a98ec8ee2bb7ecedc2128a8c7f3184c3ff14e'],
  '@sislexa/billing': ['sislex/billing', 'a3897238443664a9a49b964bced4f02212e5c7b7'],
  '@sislex/llm-runner': ['sislex/llm-runner', 'edcfb71a3ddc7b6f8ecf00558a392ec1f85315f4'],
  '@sislex/runner-contracts': ['sislex/llm-runner', 'edcfb71a3ddc7b6f8ecf00558a392ec1f85315f4'],
  '@sislexa/sdk': ['sislex/sdk', 'f6313db5ff58cc35fa8dacc90b9844f9706dcfba'],
  '@sislexa/analytics': ['sislex/analytics', 'a85d8ff1dc1e3b4d5f9e2c7bf289669f0e9da942']
})

export function requireSources(packages) {
  const errors = []
  for (const [name, [repository, commit]] of Object.entries(requiredSources)) {
    const rows = packages.filter(row => row.name === name)
    if (rows.length !== 1 || rows[0].repository !== 'https://github.com/' + repository || rows[0].commit !== commit) {
      errors.push(`${name} requires ${repository}@${commit}`)
    }
  }
  if (errors.length) throw Error('A07 composition unavailable: ' + errors.join('; '))
}

export async function verifyA07Composition(directory = root) {
  const json = file => JSON.parse(readFileSync(join(directory, file)))
  const inventory = json('vendor/owner-artifacts.json')
  requireSources(inventory.packages)
  const lock = json('package-lock.json').packages
  const tools = json('deploy/tools.lock.json').tools
  const toolNames = { '@sislexa/identity': 'identity', '@sislexa/billing': 'billing',
    '@sislex/llm-runner': 'llm-runner', '@sislexa/analytics': 'analytics' }
  const verified = []
  for (const name of Object.keys(requiredSources)) {
    const row = inventory.packages.find(item => item.name === name)
    if (!/^[\w.-]+\.tgz$/.test(row.asset)) throw Error('Invalid archive name: ' + name)
    const bytes = await ensureVendorArchive(directory, row.asset, { sha256: row.sha256, integrity: row.integrity })
    if (digest(bytes) !== row.sha256 || 'sha512-' + createHash('sha512').update(bytes).digest('base64') !== row.integrity) {
      throw Error('Artifact integrity mismatch: ' + name)
    }
    const files = await archiveFiles(bytes)
    const pkg = JSON.parse(files.get('package.json')), source = JSON.parse(files.get('release-source.json'))
    if (pkg.name !== name || pkg.version !== row.version || source.repository !== row.repository
      || source.commit !== row.commit || source.version !== row.version) throw Error('Artifact provenance mismatch: ' + name)
    // Runner is also installed as a dev dependency for exact-composition acceptance.
    {
      const installed = lock['node_modules/' + name]
      if (!isVendorRef(installed?.resolved, row.asset) || installed?.integrity !== row.integrity
        || installed?.version !== row.version) throw Error('Consumer lock mismatch: ' + name)
      for (const [file, content] of files) {
        if (digest(readFileSync(join(directory, 'node_modules', name, file))) !== digest(content)) {
          throw Error('Installed artifact mismatch: ' + name + '/' + file)
        }
      }
    }
    if (toolNames[name]) {
      const tool = tools[toolNames[name]]
      if (tool?.commit !== row.commit || tool?.version !== row.version) throw Error('Deployment lock mismatch: ' + name)
    }
    verified.push({ name, version: row.version, commit: row.commit, sha256: row.sha256 })
  }
  return verified
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const packages = await verifyA07Composition()
    console.log(JSON.stringify({ status: 'artifacts-verified', acceptance: 'not-run', commissioning: 'not-performed', packages }))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
