import { extract } from 'tar-stream'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, symlinkSync, readdirSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

export const root = resolve(import.meta.dirname, '..')
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export const requiredPackages = Object.freeze(['@sislexa/make', '@sislexa/web-reader', '@sislexa/playwright-reader', '@sislexa/core-ui', '@sislexa/desktop', '@sislexa/chat-ui', '@voicechat/chat-app', '@voicechat/ui-foundation', '@voicechat/shared', '@voicechat/make-contracts', '@voicechat/web-reader-contracts', '@voicechat/playwright-reader-contracts', '@voicechat/browser-contracts'])

export async function archiveFiles(bytes) {
  const files = new Map(), stream = extract()
  stream.on('entry', (header, entry, next) => {
    const name = header.name.replace(/^package\//, '')
    if (!header.name.startsWith('package/') || name.split('/').includes('..') || name.includes('\\') || !['file', 'directory'].includes(header.type) || files.has(name)) {
      stream.destroy(Error('Unsafe or duplicate archive entry')); return
    }
    const chunks = []
    entry.on('data', chunk => chunks.push(chunk))
    entry.on('end', () => { if (header.type === 'file') files.set(name, Buffer.concat(chunks)); next() })
    entry.on('error', error => stream.destroy(error))
  })
  await new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); stream.end(gunzipSync(bytes)) })
  return files
}

export async function verifySnapshot(snapshot, directory = root) {
  if (snapshot.schemaVersion !== 1 || snapshot.packages?.length !== requiredPackages.length || new Set(snapshot.packages.map(row => row.name)).size !== requiredPackages.length || requiredPackages.some(name => !snapshot.packages.some(row => row.name === name))) throw Error('Incomplete owner artifact set')
  const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json')))
  const archives = new Map()
  for (const row of snapshot.packages) {
    if (!/^[\w.-]+\.tgz$/.test(row.asset) || !/^[a-f0-9]{40}$/.test(row.commit)) throw Error('Invalid artifact pin')
    const bytes = readFileSync(join(directory, 'vendor', row.asset))
    if (digest(bytes) !== row.sha256 || 'sha512-' + createHash('sha512').update(bytes).digest('base64') !== row.integrity) throw Error('Artifact digest mismatch: ' + row.name)
    const files = await archiveFiles(bytes)
    const pkg = JSON.parse(files.get('package.json')), source = JSON.parse(files.get('release-source.json'))
    if (pkg.name !== row.name || pkg.version !== row.version || source.version !== row.version || source.commit !== row.commit || source.repository !== row.repository) throw Error('Artifact provenance mismatch: ' + row.name)
    const installed = lock.packages['node_modules/' + row.name]
    if (installed && !installed.link && (installed.resolved !== 'file:vendor/' + row.asset || installed.integrity !== row.integrity || installed.version !== row.version)) throw Error('Lockfile artifact mismatch: ' + row.name)
    archives.set(row.name, files)
  }
  const desktop = JSON.parse(archives.get('@sislexa/desktop').get('release-source.json'))
  const ui = JSON.parse(archives.get('@sislexa/core-ui').get('release-source.json'))
  if (desktop.dependencies.coreUi.commit !== ui.commit || desktop.dependencies.coreUi.version !== ui.version) throw Error('Desktop renderer provenance mismatch')
  const manifest = JSON.parse(archives.get('@sislexa/core-ui').get('manifest.json'))
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (digest(archives.get('@sislexa/core-ui').get(name)) !== hash) throw Error('Core UI asset mismatch')
    if (name.startsWith('renderer/')) {
      const embedded = archives.get('@sislexa/desktop').get('out/' + name)
      if (!embedded || digest(embedded) !== hash) throw Error('Desktop embeds different renderer: ' + name)
    }
  }
  return archives
}

export async function verifyInstalledSnapshot(snapshot, directory = root) {
  const archives = await verifySnapshot(snapshot, directory)
  for (const [name, files] of archives) {
    if (name === '@voicechat/shared') continue // Core deliberately uses its current workspace.
    for (const [file, bytes] of files) {
      const installed = readFileSync(join(directory, 'node_modules', name, file))
      if (digest(installed) !== digest(bytes)) throw Error('Installed owner artifact differs: ' + name + '/' + file)
    }
  }
}

// Public package consumer: published Shared is extracted alongside chat-app, never aliased to Core source.
export async function createConsumer(snapshot = JSON.parse(readFileSync(join(root, 'dependency-snapshots.json')))) {
  const archives = await verifySnapshot(snapshot)
  const base = process.env.DELIVERY_ATTEMPT_ROOT ? join(process.env.DELIVERY_ATTEMPT_ROOT, 'tmp') : tmpdir()
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'shared-chat-'))
  try {
    const modules = join(directory, 'node_modules'); mkdirSync(modules)
    for (const [name, files] of archives) for (const [file, bytes] of files) {
      const target = join(modules, name, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes)
    }
    for (const scope of readdirSync(join(root, 'node_modules'), { withFileTypes: true })) {
      if (scope.name.startsWith('.')) continue
      const names = scope.name.startsWith('@') ? readdirSync(join(root, 'node_modules', scope.name)).map(name => scope.name + '/' + name) : [scope.name]
      for (const name of names) if (!archives.has(name)) {
        mkdirSync(dirname(join(modules, name)), { recursive: true })
        symlinkSync(join(root, 'node_modules', name), join(modules, name))
      }
    }
    return { directory, archives, async importChat(part) {
      const pkg = JSON.parse(archives.get('@voicechat/chat-app').get('package.json'))
      const entry = pkg.exports['./' + part]?.import
      if (!entry) throw Error('Unknown public chat entry')
      return import(pathToFileURL(join(modules, '@voicechat/chat-app', entry)).href)
    }, close() { rmSync(directory, { recursive: true, force: true }) } }
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
}
