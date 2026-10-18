#!/usr/bin/env node
// Owner archives pinned by Core live in the public GitHub release `vendor` of sislex/voiceAIChat,
// not in git. package.json/package-lock.json reference them by URL, so `npm ci` downloads and
// verifies them by lockfile integrity. Tools that need the bytes (pin, provenance and integrity
// gates) call ensureVendorArchive(), which fills `vendor/<asset>` from a shared cache or the release.
//   node scripts/vendor-store.mjs fetch     — download every referenced archive into vendor/
//   node scripts/vendor-store.mjs publish   — upload local vendor/*.tgz missing from the release
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const VENDOR_REPOSITORY = 'sislex/voiceAIChat'
export const VENDOR_RELEASE = 'vendor'
export const VENDOR_URL = `https://github.com/${VENDOR_REPOSITORY}/releases/download/${VENDOR_RELEASE}/`
const ASSET = /^[\w.@+-]+\.tgz$/
const MANIFESTS = ['vendor/owner-artifacts.json', 'vendor/ui-libraries.json', 'dependency-snapshots.json']

/** Dependency spec / lockfile `resolved` for a pinned archive. */
export function vendorRef(asset) {
  if (!ASSET.test(asset)) throw Error('Invalid vendor archive name: ' + asset)
  return VENDOR_URL + asset
}

/** Archive name of a spec in either form (`file:[../../]vendor/X.tgz` or the release URL), else null. */
export function vendorAssetFromRef(spec) {
  if (typeof spec !== 'string') return null
  const match = spec.startsWith(VENDOR_URL) ? spec.slice(VENDOR_URL.length) : /^file:(?:\.\.\/)*vendor\/(.+)$/.exec(spec)?.[1]
  return match && ASSET.test(match) ? match : null
}

export function isVendorRef(spec, asset) {
  return vendorAssetFromRef(spec) === asset
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const sri = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64')

function matches(bytes, expect) {
  return (!expect.sha256 || sha256(bytes) === expect.sha256) && (!expect.integrity || sri(bytes) === expect.integrity)
}

export function vendorCacheDir() {
  return process.env.SISLEXA_VENDOR_CACHE || join(homedir(), '.cache', 'sislexa', 'vendor')
}

async function download(url, attempts, fetchImpl) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
      if (!response.ok) throw Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      last = error
      if (attempt < attempts) await new Promise(done => setTimeout(done, Math.min(500 * 2 ** attempt, 8000)))
    }
  }
  throw Error(`Cannot download ${url}: ${last?.message ?? last}`)
}

/**
 * Make `vendor/<asset>` present with the expected bytes (sha256 and/or sha512 integrity required).
 * Order: existing file → shared cache → release download. Writes are atomic.
 */
export async function ensureVendorArchive(root, asset, expect, { attempts = 5, fetchImpl = fetch, baseUrl = VENDOR_URL } = {}) {
  if (!ASSET.test(asset)) throw Error('Invalid vendor archive name: ' + asset)
  if (!expect?.sha256 && !expect?.integrity) throw Error('No checksum for vendor archive ' + asset)
  const target = join(root, 'vendor', asset)
  if (existsSync(target)) {
    const bytes = readFileSync(target)
    if (matches(bytes, expect)) return bytes
    throw Error(`vendor/${asset} differs from its pinned checksum; delete it and fetch again`)
  }
  const cache = join(vendorCacheDir(), asset)
  let bytes = existsSync(cache) ? readFileSync(cache) : null
  if (!bytes || !matches(bytes, expect)) {
    bytes = await download(baseUrl + asset, attempts, fetchImpl)
    if (!matches(bytes, expect)) throw Error(`Downloaded ${asset} does not match its pinned checksum`)
    atomicWrite(cache, bytes)
  }
  atomicWrite(target, bytes)
  return bytes
}

function atomicWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, bytes)
  renameSync(temp, path)
}

/** Every pinned archive with its checksum: package-lock integrity plus manifest sha256. */
export function pinnedArchives(root) {
  const archives = new Map()
  const add = (asset, sum) => {
    if (!asset) return
    const row = archives.get(asset) ?? {}
    archives.set(asset, { ...row, ...Object.fromEntries(Object.entries(sum).filter(([, value]) => value)) })
  }
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages ?? {}
  for (const entry of Object.values(lock)) add(vendorAssetFromRef(entry.resolved), { integrity: entry.integrity })
  for (const file of MANIFESTS) {
    if (!existsSync(join(root, file))) continue
    for (const row of JSON.parse(readFileSync(join(root, file), 'utf8')).packages ?? []) {
      if (typeof row.asset === 'string' && ASSET.test(row.asset)) add(row.asset, { sha256: row.sha256, integrity: row.integrity })
    }
  }
  return archives
}

export async function fetchVendorArchives(root, options) {
  const archives = pinnedArchives(root)
  for (const [asset, expect] of archives) await ensureVendorArchive(root, asset, expect, options)
  return [...archives.keys()]
}

/** Assets already in the release (needs `gh` auth for the listing only). */
function releaseAssets() {
  const out = execFileSync('gh', ['release', 'view', VENDOR_RELEASE, '-R', VENDOR_REPOSITORY, '--json', 'assets', '--jq', '.assets[].name'], { encoding: 'utf8' })
  return new Set(out.split('\n').filter(Boolean))
}

/** Upload local archives the release lacks. Existing assets are immutable and never replaced. */
export function publishVendorArchives(root, { assets = releaseAssets(), upload = file => execFileSync('gh', ['release', 'upload', VENDOR_RELEASE, file, '-R', VENDOR_REPOSITORY], { stdio: 'inherit' }) } = {}) {
  const dir = join(root, 'vendor')
  const uploaded = []
  for (const file of existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.tgz')).sort() : []) {
    if (assets.has(file)) continue
    upload(join(dir, file))
    uploaded.push(file)
  }
  return uploaded
}

/** Fail when an archive is tracked in git (they belong to the release). */
export function trackedVendorArchives(root) {
  return execFileSync('git', ['ls-files', '-z', '--', 'vendor'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file.endsWith('.tgz'))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const command = process.argv[2]
  if (command === 'fetch') {
    const assets = await fetchVendorArchives(root)
    console.log(`vendor: ${assets.length} archives present`)
  } else if (command === 'publish') {
    const uploaded = publishVendorArchives(root)
    console.log(uploaded.length ? 'vendor: uploaded ' + uploaded.join(', ') : 'vendor: release already has every local archive')
  } else if (command === 'check') {
    const tracked = trackedVendorArchives(root)
    if (tracked.length) { console.error('Archives must not be committed (use the vendor release):\n' + tracked.join('\n')); process.exit(1) }
    console.log('vendor: no archives tracked in git')
  } else {
    console.error('Usage: node scripts/vendor-store.mjs fetch|publish|check'); process.exit(2)
  }
}

// Remove partial temp files left by an interrupted write (best effort, never fatal).
export function cleanVendorTemp(root) {
  const dir = join(root, 'vendor')
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) if (name.endsWith('.tmp')) rmSync(join(dir, name), { force: true })
}
