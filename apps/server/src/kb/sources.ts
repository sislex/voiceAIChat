import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ModuleKnowledgeBaseService as Engine, readKbSources as readSources, type KbSource } from '../../../../packages/knowledge/src/sources.js'
import type { KbGit } from '../../../../packages/knowledge/src/ports.js'
import type { KbSemanticReranker } from './types.js'
import { kbFiles } from './files.js'
export { repositoryKey, type KbSource, type ModuleState } from '../../../../packages/knowledge/src/sources.js'
const execute = promisify(execFile)
export const readKbSources = (dataDir: string, override = process.env.VC_KB_MODULES) => readSources(dataDir, kbFiles, override)
export interface GitCredential { username: string; password: string }
export type KbCredentials = (repository: string) => Promise<GitCredential | null>

/** Read the existing Git integration credential store; never persist its answer. */
export function gitStoreCredentials(githubToken?: string): KbCredentials {
  return async (repository) => {
    if (!repository.startsWith('https://')) return null
    const url = new URL(repository)
    if (url.hostname === 'github.com' && githubToken) return { username: 'x-access-token', password: githubToken }
    return new Promise((resolve) => {
      const child = execFile('git', ['credential', 'fill'], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false', GCM_INTERACTIVE: 'never' },
        timeout: 15_000, maxBuffer: 64 * 1024
      }, (error, stdout) => {
        if (error) return resolve(null)
        const fields = new Map(stdout.trim().split('\n').map(line => {
          const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]
        }))
        resolve(fields.get('password') ? { username: fields.get('username') ?? 'x-access-token', password: fields.get('password')! } : null)
      })
      child.stdin?.on('error', () => {})
      child.stdin?.end(`protocol=https\nhost=${url.host}\npath=${url.pathname.slice(1)}\n\n`)
    })
  }
}


export function createKbGit(dataDir: string, credentials?: KbCredentials): KbGit {
  return { async checkout(source, previousSha) {
    const checkout = join(dataDir, 'kb-cache', source.id)
    mkdirSync(checkout, { recursive: true })
    const credential = await credentials?.(source.repository)
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false',
      GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'http.followRedirects', GIT_CONFIG_VALUE_1: 'false' }
    if (credential && source.repository.startsWith('https://')) {
      env.GIT_CONFIG_COUNT = '3'
      env.GIT_CONFIG_KEY_2 = `http.${source.repository}.extraHeader`
      env.GIT_CONFIG_VALUE_2 = `Authorization: Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`
    }
    const git = async (...args: string[]): Promise<string> => (await execute('git', args, {
      cwd: checkout, env, timeout: 60_000, maxBuffer: 2 * 1024 * 1024
    })).stdout.trim()
    if (!existsSync(join(checkout, '.git'))) await git('init', '--quiet')
    // A named promisor remote lets checkout lazily fetch blobs for the sparse path.
    // The URL is validated and contains no credentials.
    await git('config', 'remote.origin.url', source.repository)
    await git('config', 'remote.origin.promisor', 'true')
    await git('config', 'remote.origin.partialclonefilter', 'blob:none')
    await git('config', 'core.sparseCheckout', 'true')
    // Non-cone mode excludes sibling/root files as well as sibling directories.
    await git('sparse-checkout', 'set', '--no-cone', `/${source.path}/`)
    await git('fetch', '--depth', '1', '--filter=blob:none', '--no-tags', 'origin', source.ref)
    const sha = await git('rev-parse', 'FETCH_HEAD')
    if (sha === previousSha) return { root: join(checkout, source.path), sha }
    await git('checkout', '--force', '--detach', 'FETCH_HEAD')
    const root = join(checkout, source.path)
    // Reject a symlink in any component of the selected docs path.
    if (realpathSync(root) !== join(realpathSync(checkout), source.path)) throw new Error('Invalid docs path')
    return { root, sha }
  } }
}
export class ModuleKnowledgeBaseService extends Engine {
  constructor(options: { root: string; dataDir: string; sources?: KbSource[]; credentials?: KbCredentials; refreshMs?: number; managedByEnv?: boolean }, reranker?: KbSemanticReranker) {
    super({ ...options, sources: options.sources ?? readKbSources(options.dataDir), files: kbFiles, git: createKbGit(options.dataDir, options.credentials),
      writeSources: (sources) => {
        const file = join(options.dataDir, 'kb-modules.json')
        mkdirSync(options.dataDir, { recursive: true })
        writeFileSync(file + '.tmp', JSON.stringify(sources, null, 2) + '\n')
        renameSync(file + '.tmp', file)
      } }, reranker)
  }
}
