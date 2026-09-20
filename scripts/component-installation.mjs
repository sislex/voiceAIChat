import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createComponentRuntime } from '@sislexa/component-runtime'
import { parseComponentContract, parseComponentConfig } from '@voicechat/shared'
const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const ids = ['core', 'make', 'playwright-reader', 'web-reader', 'image-studio', 'stt-runner', 'tts-runner']
const contractFile = id => id === 'core' ? join(repository, 'apps/server/component-contract.json') : require.resolve(id.endsWith('-runner') ? `@sislexa/voice/${id}/component-contract` : `@sislexa/${id}/component-contract`)

/** Initialize an entirely new installation; existing registries are never overwritten. */
export async function initializeComponents({ directory, environmentId, origins = {}, container = false, ttlSeconds = 2592000 }) {
  const root = resolve(directory)
  const contracts = Object.fromEntries(ids.map(id => [id, parseComponentContract(JSON.parse(readFileSync(contractFile(id), 'utf8')))]))
  // Validate every setting before creating any private storage.
  const configs = Object.fromEntries(ids.map(id => {
    const config = JSON.parse(readFileSync(join(repository, 'deploy/components', id + '.example.json'), 'utf8'))
    config.environmentId = environmentId
    const runtimeRoot = container ? '/run/sislexa' : join(root, id)
    config.registryDirectory = join(runtimeRoot, 'provider')
    config.dependencies = config.dependencies.map(d => ({ ...d, url: origins[d.applicationId] ?? d.url, tokenFile: join(runtimeRoot, 'outgoing', d.applicationId + '.token') }))
    return [id, parseComponentConfig(config, contracts[id])]
  }))
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || Object.values(configs).some(c => c.grants.some(g => ttlSeconds > g.maxTtlSeconds))) throw Error('Token lifetime exceeds installation grants')
  mkdirSync(root, { mode: 0o700 })
  const issued = []
  try {
    for (const id of ids) {
      mkdirSync(join(root, id), { mode: 0o700 })
      mkdirSync(join(root, id, 'outgoing'), { mode: 0o700 })
      writeFileSync(join(root, id, 'config.json'), JSON.stringify(configs[id], null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    }
    for (const id of ids) {
      const temporary = join(root, id, '.issuer.json')
      writeFileSync(temporary, JSON.stringify({ ...configs[id], registryDirectory: join(root, id, 'provider') }), { mode: 0o600, flag: 'wx' })
      const runtime = await createComponentRuntime({ contractFile: contractFile(id), configFile: temporary, metadata: { applicationId: id, version: null, apiVersion: null, dataVersion: null, commit: null } })
      try {
        for (const grant of configs[id].grants) {
          const required = contracts[grant.consumerId].dependencies.find(d => d.applicationId === id)
          if (!required) throw Error('Consumer does not declare this provider')
          const result = runtime.registry.issue(grant.consumerId, required.scopes, ttlSeconds)
          writeFileSync(join(root, grant.consumerId, 'outgoing', id + '.token'), result.token + '\n', { mode: 0o600, flag: 'wx' })
          issued.push(result.principal)
        }
      } finally { runtime.close(); rmSync(temporary) }
    }
    return { environmentId, issued }
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), options = new Map()
    for (let i = 0; i < args.length; i += 2) {
      if (!['--directory', '--environment', '--container', '--ttl', ...ids.map(id => '--' + id + '-url')].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw Error('Invalid installation options')
      options.set(args[i], args[i + 1])
    }
    if (!options.get('--directory') || !options.get('--environment') || (options.has('--container') && !['true', 'false'].includes(options.get('--container')))) throw Error('Directory and environment are required')
    const origins = Object.fromEntries(ids.filter(id => options.has('--' + id + '-url')).map(id => [id, options.get('--' + id + '-url')]))
    console.log(JSON.stringify(await initializeComponents({ directory: options.get('--directory'), environmentId: options.get('--environment'), origins, container: options.get('--container') === 'true', ttlSeconds: options.has('--ttl') ? Number(options.get('--ttl')) : 2592000 })))
  } catch { console.error('Component initialization failed; check the new directory, origins, environment and token lifetime.'); process.exitCode = 1 }
}
