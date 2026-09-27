// Artifact preflight only. A successful preflight is not end-to-end acceptance.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { archiveFiles, digest, root } from './shared-chat-artifacts.mjs'

export const requiredSources = Object.freeze({
  '@sislexa/identity': ['sislex/identity', 'a88c1fca8bb576702a091c628cfeb4de650511d5'],
  '@sislexa/billing': ['sislex/billing', '7c54c7fc203a8dfff79533a70d712de4e002328a'],
  '@sislex/llm-runner': ['sislex/llm-runner', '097282f2418c245454fe963b10d9b61e0b4d814a'],
  '@sislex/runner-contracts': ['sislex/llm-runner', '097282f2418c245454fe963b10d9b61e0b4d814a'],
  '@sislexa/sdk': ['sislex/sdk', 'f6313db5ff58cc35fa8dacc90b9844f9706dcfba'],
  '@sislexa/analytics': ['sislex/analytics', 'f398196a38438cc818d9d5c6db375c205dd0dea3']
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
    const bytes = readFileSync(join(directory, 'vendor', row.asset))
    if (digest(bytes) !== row.sha256 || 'sha512-' + createHash('sha512').update(bytes).digest('base64') !== row.integrity) {
      throw Error('Artifact integrity mismatch: ' + name)
    }
    const files = await archiveFiles(bytes)
    const pkg = JSON.parse(files.get('package.json')), source = JSON.parse(files.get('release-source.json'))
    if (pkg.name !== name || pkg.version !== row.version || source.repository !== row.repository
      || source.commit !== row.commit || source.version !== row.version) throw Error('Artifact provenance mismatch: ' + name)
    // Runner is deployed separately; the other five archives are Core runtime dependencies.
    if (name !== '@sislex/llm-runner') {
      const installed = lock['node_modules/' + name]
      if (installed?.resolved !== 'file:vendor/' + row.asset || installed?.integrity !== row.integrity
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
