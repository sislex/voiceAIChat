import type {
  BrowserUiActivation,
  BrowserUiPublishedRelease,
  BrowserUiRelease,
  BrowserUiReleaseActionInput,
  BrowserUiReleaseOperation,
  BrowserUiReleaseOverview,
  BrowserUiRuntime
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import type { ReleaseProjectTarget, ReleaseRuntime } from './releaseManager.js'
import { shellQuote } from '../ci/executor.js'

const REPOSITORY = 'sislex/sislexa-core-ui'
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,100}$/
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024

interface GitHubAsset { id: number; name: string; size: number; url: string }
interface GitHubRelease { tag_name: string; draft: boolean; prerelease: boolean; published_at: string; assets: GitHubAsset[] }
interface BrowserUiInspection { runtime: BrowserUiRuntime; activation: BrowserUiActivation | null; installed: BrowserUiRelease[] }

export interface BrowserUiReleaseRuntime {
  exec(target: ReleaseProjectTarget, command: string, timeoutMs: number): Promise<{ exitCode: number | null; output: string; timedOut?: boolean }>
  write(agentId: string, path: string, dataBase64: string): Promise<unknown>
  remove(agentId: string, path: string): Promise<unknown>
}

export class BrowserUiReleaseCatalog {
  private cache: { at: number; releases: BrowserUiPublishedRelease[]; assets: Map<string, GitHubAsset> } | null = null
  constructor(private readonly token: string | undefined, private readonly fetchImpl: typeof fetch = fetch) {}
  private headers(accept = 'application/vnd.github+json'): Record<string, string> {
    return { Accept: accept, 'User-Agent': 'sislexa-core-release-center', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }
  }
  private async json<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`https://api.github.com/repos/${REPOSITORY}${path}`, { headers: this.headers(), signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`GitHub browser release catalog returned ${response.status}`)
    return await response.json() as T
  }
  private async commit(tag: string): Promise<string> {
    let object = (await this.json<{ object: { type: string; sha: string } }>(`/git/ref/tags/${encodeURIComponent(tag)}`)).object
    if (object.type === 'tag') object = (await this.json<{ object: { type: string; sha: string } }>(`/git/tags/${object.sha}`)).object
    if (object.type !== 'commit' || !/^[a-f0-9]{40}$/.test(object.sha)) throw new Error(`Tag ${tag} does not resolve to a commit`)
    return object.sha
  }
  async list(force = false): Promise<BrowserUiPublishedRelease[]> {
    if (!force && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.releases
    const source = await this.json<GitHubRelease[]>('/releases?per_page=30')
    const releases: BrowserUiPublishedRelease[] = [], assets = new Map<string, GitHubAsset>()
    for (const release of source) {
      const version = release.tag_name.replace(/^v/, '')
      if (release.draft || release.prerelease || !VERSION.test(version)) continue
      const commit = await this.commit(release.tag_name)
      const name = `sislexa-core-ui-browser-${version}-${commit.slice(0, 12)}.tgz`
      const asset = release.assets.find(item => item.name === name)
      if (!asset || asset.size <= 0 || asset.size > MAX_ARCHIVE_BYTES) continue
      releases.push({ version, tag: release.tag_name, commit, assetName: name, size: asset.size, publishedAt: release.published_at })
      assets.set(version, asset)
    }
    releases.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
    this.cache = { at: Date.now(), releases, assets }
    return releases
  }
  async download(version: string): Promise<{ release: BrowserUiPublishedRelease; data: Buffer }> {
    const release = (await this.list(true)).find(item => item.version === version)
    const asset = this.cache?.assets.get(version)
    if (!release || !asset) throw new Error('Published browser UI release was not found')
    const response = await this.fetchImpl(asset.url, { headers: this.headers('application/octet-stream'), redirect: 'follow', signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Browser UI archive download returned ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length !== asset.size || data.length > MAX_ARCHIVE_BYTES) throw new Error('Browser UI archive size changed during download')
    return { release, data }
  }
}

function installCommand(path: string, expectedId: string, checkout: string): string {
  const script = `const fs=require('node:fs');const value=JSON.parse(fs.readFileSync(0,'utf8'));if(value.runtime.active!==process.env.BUI_EXPECTED)throw Error('Activated browser UI does not match the published tag');console.log('BROWSER_UI_RESULT='+JSON.stringify({inspection:value,coreContainerUnchanged:process.env.BUI_BEFORE===process.env.BUI_AFTER}))`
  return [
    'set -eu',
    `cd ${shellQuote(checkout)}`,
    'stage=$(mktemp -d)',
    `cleanup(){ rm -rf "$stage" ${shellQuote(path)}; }`,
    'trap cleanup EXIT',
    `tar -xzf ${shellQuote(path)} -C "$stage" --no-same-owner --no-same-permissions`,
    'before=$(docker inspect -f "{{.Id}} {{.State.StartedAt}}" "$(docker compose ps -q voicechat)")',
    'voicechat-ui-deploy install "$stage"',
    'after=$(docker inspect -f "{{.Id}} {{.State.StartedAt}}" "$(docker compose ps -q voicechat)")',
    `BUI_EXPECTED=${shellQuote(expectedId)} BUI_BEFORE="$before" BUI_AFTER="$after" voicechat-ui-deploy inspect | node -e ${shellQuote(script)}`
  ].join('\n')
}

function activationCommand(action: 'rollback' | 'activate-bundled', checkout: string): string {
  const command = action === 'rollback' ? 'rollback' : 'activate --release bundled'
  const script = `const fs=require('node:fs');const value=JSON.parse(fs.readFileSync(0,'utf8'));console.log('BROWSER_UI_RESULT='+JSON.stringify({inspection:value,coreContainerUnchanged:process.env.BUI_BEFORE===process.env.BUI_AFTER}))`
  return [
    'set -eu',
    `cd ${shellQuote(checkout)}`,
    'before=$(docker inspect -f "{{.Id}} {{.State.StartedAt}}" "$(docker compose ps -q voicechat)")',
    `voicechat-ui-deploy ${command}`,
    'after=$(docker inspect -f "{{.Id}} {{.State.StartedAt}}" "$(docker compose ps -q voicechat)")',
    `BUI_BEFORE="$before" BUI_AFTER="$after" voicechat-ui-deploy inspect | node -e ${shellQuote(script)}`
  ].join('\n')
}

export class BrowserUiReleaseManager {
  constructor(private readonly db: VoiceChatDb, private readonly runtime: BrowserUiReleaseRuntime, private readonly catalog: BrowserUiReleaseCatalog) {}
  private async inspect(target: ReleaseProjectTarget): Promise<BrowserUiInspection> {
    const result = await this.runtime.exec(target, 'voicechat-ui-deploy inspect', 30_000)
    if (result.exitCode !== 0 || result.timedOut) throw new Error(result.output || 'Browser UI status is unavailable')
    return JSON.parse(result.output) as BrowserUiInspection
  }
  async overview(userId: string, projectId: string, target: ReleaseProjectTarget): Promise<BrowserUiReleaseOverview> {
    const operations = await this.db.releases.browserUiReleaseOperations(userId, projectId)
    const [inspection, published] = await Promise.allSettled([this.inspect(target), this.catalog.list()])
    const value = inspection.status === 'fulfilled' ? inspection.value : null
    const errors = [inspection, published].flatMap(item => item.status === 'rejected' ? [item.reason instanceof Error ? item.reason.message : String(item.reason)] : [])
    return { runtime: value?.runtime ?? null, activation: value?.activation ?? null, installed: value?.installed ?? [], published: published.status === 'fulfilled' ? published.value : [], operations, statusError: errors.join('; ') || null }
  }
  async act(userId: string, projectId: string, target: ReleaseProjectTarget, input: BrowserUiReleaseActionInput): Promise<BrowserUiReleaseOperation> {
    if (!REQUEST_ID.test(input?.requestId) || !['install', 'rollback', 'activate-bundled'].includes(input?.action)) throw new Error('Invalid browser UI release action')
    if (input.action === 'install' && (!input.version || !VERSION.test(input.version))) throw new Error('Expected a published browser UI version')
    const started = await this.db.releases.beginBrowserUiReleaseOperation(userId, projectId, { requestId: input.requestId, action: input.action, version: input.version })
    if (!started.created) return started.record
    let releaseId: string | null = null, archivePath: string | null = null
    try {
      let command: string
      if (input.action === 'install') {
        const downloaded = await this.catalog.download(input.version!)
        releaseId = `${downloaded.release.version}-${downloaded.release.commit}`
        archivePath = `${target.path.replace(/\/$/, '')}/.browser-ui-${started.record.id}.tgz`
        await this.runtime.write(target.agentId, archivePath, downloaded.data.toString('base64'))
        command = installCommand(archivePath, releaseId, target.path)
      } else command = activationCommand(input.action, target.path)
      const result = await this.runtime.exec(target, command, 180_000)
      const marker = result.output.lastIndexOf('BROWSER_UI_RESULT=')
      if (result.exitCode !== 0 || result.timedOut || marker < 0) throw new Error(result.output || 'Browser UI operation did not return a verified result')
      const parsed = JSON.parse(result.output.slice(marker + 'BROWSER_UI_RESULT='.length).trim()) as { inspection: BrowserUiInspection; coreContainerUnchanged: boolean }
      if (!parsed.coreContainerUnchanged) throw new Error('Core container changed during browser UI operation')
      releaseId = parsed.inspection.runtime.active
      return await this.db.releases.finishBrowserUiReleaseOperation(started.record.id, { releaseId, status: 'succeeded', log: result.output, coreContainerUnchanged: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return await this.db.releases.finishBrowserUiReleaseOperation(started.record.id, { releaseId, status: 'failed', log: message, coreContainerUnchanged: null })
    } finally {
      if (archivePath) await this.runtime.remove(target.agentId, archivePath).catch(() => undefined)
    }
  }
}

export function createBrowserUiReleaseRuntime(runtime: Pick<ReleaseRuntime, 'exec'>, files: Pick<BrowserUiReleaseRuntime, 'write' | 'remove'>): BrowserUiReleaseRuntime {
  return { exec: (target, command, timeoutMs) => runtime.exec(target, command, timeoutMs), ...files }
}
