import { createHash, randomUUID } from 'node:crypto'
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { BROWSER_UI_COMPATIBILITY, BROWSER_UI_RELEASE_PREFIX, browserUiReleaseId, parseBrowserUiRelease, type BrowserUiActivation, type BrowserUiCompatibility, type BrowserUiRelease, type BrowserUiRuntime } from '@voicechat/shared'

export function verifyBrowserUi(directory: string, compatibility = BROWSER_UI_COMPATIBILITY): BrowserUiRelease {
  const root = realpathSync(directory)
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(root).isDirectory()) throw Error('Browser UI directory must not contain links')
  const manifestPath = join(root, 'manifest.json')
  if (!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).nlink !== 1 || realpathSync(manifestPath) !== manifestPath) throw Error('Unsafe browser UI manifest')
  if (lstatSync(manifestPath).size > 2 * 1024 * 1024) throw Error('Browser UI manifest exceeds size limit')
  const release = parseBrowserUiRelease(JSON.parse(readFileSync(manifestPath, 'utf8')), compatibility)
  const seen = new Set<string>()
  let bytes = 0
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), key = relative(root, path)
      if (entry.isSymbolicLink()) throw Error('Browser UI links are forbidden')
      if (entry.isDirectory()) { visit(path); continue }
      if (!entry.isFile()) throw Error('Browser UI special files are forbidden')
      if (lstatSync(path).nlink !== 1) throw Error('Browser UI hard links are forbidden')
      if (key === 'manifest.json') continue
      if (!Object.hasOwn(release.files, key)) throw Error('Unlisted browser UI asset: ' + key)
      bytes += lstatSync(path).size
      if (bytes > 250 * 1024 * 1024) throw Error('Browser UI artifact exceeds size limit')
      const content = readFileSync(path)
      if (createHash('sha256').update(content).digest('hex') !== release.files[key]) throw Error('Browser UI integrity mismatch: ' + key)
      seen.add(key)
    }
  }
  visit(root)
  if (seen.size !== Object.keys(release.files).length) throw Error('Missing browser UI asset')
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  if (!html.includes(`${BROWSER_UI_RELEASE_PREFIX}${release.id}/`) || /(?:src|href)=["']\/assets\//.test(html)) throw Error('Browser UI requires a release-specific asset base')
  return release
}

export function readBrowserUiActivation(root: string): BrowserUiActivation | null {
  const path = join(root, 'active.json')
  if (!existsSync(path)) return null
  const value = JSON.parse(readFileSync(path, 'utf8')) as BrowserUiActivation
  if (value.schemaVersion !== 1 || typeof value.generation !== 'string' || !value.generation ||
      (value.active !== null && !browserUiReleaseId(value.active)) ||
      (value.previous !== null && !browserUiReleaseId(value.previous)) ||
      typeof value.actor !== 'string' || typeof value.activatedAt !== 'string') throw Error('Invalid browser UI activation record')
  return value
}

// Readers see either complete generation. Assets stay immutable and are never
// deleted by activation, so tabs from a previous release can load lazy chunks.
export function activateBrowserUi(root: string, id: string | null, compatibility: BrowserUiCompatibility, actor: string, expectedGeneration?: string | null): BrowserUiActivation {
  if (id !== null && !browserUiReleaseId(id)) throw Error('Invalid browser UI release ID')
  if (!actor.trim() || actor.length > 200) throw Error('Expected a deployment actor')
  mkdirSync(root, { recursive: true })
  const lock = join(root, 'activation.lock'), fd = openSync(lock, 'wx')
  const temporary = join(root, `active-${randomUUID()}.tmp`)
  try {
    const previous = readBrowserUiActivation(root)
    if (expectedGeneration !== undefined && (previous?.generation ?? null) !== expectedGeneration) throw Error('Browser UI activation changed; inspect current status before retrying')
    if (id) {
      const manifest = verifyBrowserUi(join(root, 'releases', id), compatibility)
      if (manifest.id !== id) throw Error('Browser UI release directory mismatch')
    }
    if ((previous?.active ?? null) === id && previous) return previous
    const next: BrowserUiActivation = { schemaVersion: 1, generation: randomUUID(), active: id, previous: previous?.active ?? null, activatedAt: new Date().toISOString(), actor }
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' })
    renameSync(temporary, join(root, 'active.json'))
    return next
  } finally { closeSync(fd); rmSync(lock, { force: true }); rmSync(temporary, { force: true }) }
}

export class BrowserUiReleases {
  private activation: BrowserUiActivation | null = null
  private record = ''
  private verified = new Map<string, BrowserUiRelease>()
  constructor(readonly root: string, readonly bundledDirectory: string, readonly compatibility = BROWSER_UI_COMPATIBILITY) {}
  release(id: string): BrowserUiRelease {
    if (!browserUiReleaseId(id)) throw Error('Invalid browser UI release ID')
    let release = this.verified.get(id)
    if (!release) {
      release = verifyBrowserUi(join(this.root, 'releases', id), this.compatibility)
      if (release.id !== id) throw Error('Browser UI release directory mismatch')
      this.verified.set(id, release)
    }
    return release
  }
  refresh(): void {
    try {
      const path = join(this.root, 'active.json')
      if (!existsSync(path)) return
      const raw = readFileSync(path, 'utf8')
      if (raw === this.record) return
      const activation = readBrowserUiActivation(this.root)!
      if (activation.active) this.release(activation.active)
      this.activation = activation
      this.record = raw
    } catch {
      // A failed or incompatible external write must not break the running UI.
      // The deployment command reports validation errors to its caller.
    }
  }
  directory(): string {
    this.refresh()
    return this.activation?.active ? join(this.root, 'releases', this.activation.active) : this.bundledDirectory
  }
  runtime(): BrowserUiRuntime {
    this.refresh()
    let configuredGeneration: string | null = null
    try { configuredGeneration = readBrowserUiActivation(this.root)?.generation ?? null } catch { /* Keep the last verified UI available. */ }
    return { schemaVersion: 1, ...this.compatibility, active: this.activation?.active ?? null, generation: this.activation?.generation ?? null, configuredGeneration }
  }
}

export function installBrowserUi(root: string, source: string, compatibility: BrowserUiCompatibility): BrowserUiRelease {
  const release = verifyBrowserUi(source, compatibility)
  const directory = join(root, 'releases', release.id)
  mkdirSync(join(root, 'releases'), { recursive: true })
  if (existsSync(directory)) {
    verifyBrowserUi(directory, compatibility)
    if (readFileSync(join(directory, 'manifest.json'), 'utf8') !== readFileSync(join(source, 'manifest.json'), 'utf8')) throw Error('Browser UI release ID is immutable')
    return release
  }
  const temporary = join(root, `install-${randomUUID()}`)
  try {
    cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false })
    verifyBrowserUi(temporary, compatibility)
    renameSync(temporary, directory)
    return release
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
