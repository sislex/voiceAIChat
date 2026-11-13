import { readdirSync, readFileSync, lstatSync, mkdirSync, rmdirSync, openSync, closeSync, writeFileSync, fchmodSync, fchownSync, fsyncSync, renameSync, unlinkSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseComponentContract, parseComponentConfig } from '@voicechat/shared'
import { ComponentTokenRegistry } from '../packages/component-runtime/src/registry.ts'
import { readSecret, assertPrivate } from '../packages/component-runtime/src/files.ts'

const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const contractFor = id => id === 'core' ? join(repository, 'apps/server/component-contract.json')
  : require.resolve(id.endsWith('-runner') ? `@sislexa/voice/${id}/component-contract` : `@sislexa/${id}/component-contract`)

/** Run as the installation owner. Only installed, digest-matched credentials can be renewed. */
export async function rotateComponents({ directory, days = 7, apply = false, now = Date.now, contractFile = contractFor }) {
  if (!Number.isFinite(days) || days <= 0 || days > 365) throw Error('Invalid rotation horizon')
  const root = resolve(directory)
  assertPrivate(root, true)
  const lock = join(root, '.rotation-lock')
  mkdirSync(lock, { mode: 0o700 })
  const results = []
  try {
    for (const id of readdirSync(root).sort()) {
      if (id.startsWith('.')) continue
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw Error('Invalid installation entry')
      const home = join(root, id)
      assertPrivate(home, true)
      const contract = parseComponentContract(JSON.parse(readFileSync(contractFile(id), 'utf8')))
      if (contract.applicationId !== id) throw Error('Provider identity mismatch')
      const config = parseComponentConfig(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')), contract)
      if (!config.registryDirectory) continue
      const registryDirectory = join(home, 'provider')
      assertPrivate(join(registryDirectory, 'tokens.sqlite'))
      const registry = new ComponentTokenRegistry(contract, { ...config, registryDirectory }, now)
      try {
        for (const grant of config.grants) {
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(grant.consumerId)) throw Error('Invalid consumer')
          const consumerHome = join(root, grant.consumerId)
          assertPrivate(consumerHome, true)
          const outgoing = join(consumerHome, 'outgoing')
          assertPrivate(outgoing, true)
          const file = join(outgoing, id + '.token')
          const token = readSecret(file), old = registry.installed(token)
          if (!old || old.consumerId !== grant.consumerId) throw Error('Installed token does not match provider registry')
          const consumerConfig = JSON.parse(readFileSync(join(consumerHome, 'config.json'), 'utf8'))
          if (consumerConfig.environmentId !== config.environmentId) throw Error('Consumer environment mismatch')
          const required = parseComponentContract(JSON.parse(readFileSync(contractFile(grant.consumerId), 'utf8'))).dependencies.find(d => d.applicationId === id)
          if (!required || required.scopes.some(s => !old.scopes.includes(s)) || old.scopes.some(s => !grant.scopes.includes(s))) throw Error('Installed scopes do not match current grants')
          if (old.expiresAt > now() + days * 86400000) continue
          const result = { providerId: id, consumerId: old.consumerId, expiresAt: old.expiresAt,
            warning: old.expiresAt <= now() + 7 * 86400000 ? 'component_token_expiring' : null, action: apply ? 'rotated' : 'would_rotate' }
          if (apply) {
            const stat = lstatSync(file)
            const issued = registry.issue(old.consumerId, old.scopes, grant.maxTtlSeconds)
            const temporary = join(dirname(file), '.rotation-' + randomUUID())
            let published = false
            try {
              const fd = openSync(temporary, 'wx', 0o600)
              try {
                writeFileSync(fd, issued.token + '\n')
                fchownSync(fd, stat.uid, stat.gid)
                fchmodSync(fd, stat.mode & 0o777)
                fsyncSync(fd)
              } finally { closeSync(fd) }
              if (!registry.authorize('Bearer ' + readSecret(temporary), required.scopes).ok) throw Error('Replacement authorization failed')
              if (readSecret(file) !== token) throw Error('Installed token changed during rotation')
              renameSync(temporary, file)
              published = true
              const directoryFd = openSync(dirname(file), 'r')
              try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
              if (!registry.authorize('Bearer ' + readSecret(file), required.scopes).ok) throw Error('Published token authorization failed')
              registry.revoke(old.tokenId)
              result.expiresAt = issued.principal.expiresAt
            } catch (error) {
              // Retain both grants after publication if a later step fails.
              if (!published) registry.revoke(issued.principal.tokenId)
              throw error
            } finally { try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error } }
          }
          results.push(result)
        }
      } finally { registry.close() }
    }
    return { apply, results }
  } finally { rmdirSync(lock) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    let directory, days = 7, apply = false
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--apply') apply = true
      else if (args[i] === '--dry-run') apply = false
      else if (args[i] === '--directory') directory = args[++i]
      else if (args[i] === '--days') days = Number(args[++i])
      else throw Error('Invalid rotation option')
    }
    if (!directory) throw Error('Installation directory required')
    console.log(JSON.stringify(await rotateComponents({ directory, days, apply })))
  } catch { console.error('Component rotation failed; check installation ownership, grants and rotation lock. No secrets are logged.'); process.exitCode = 1 }
}
