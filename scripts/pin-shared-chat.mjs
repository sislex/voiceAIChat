// Import only the assigned, checksum-verified delivery handoff. Never publish artifacts.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { archiveFiles } from './shared-chat-artifacts.mjs'
import { join, resolve } from 'node:path'
const input = process.argv[2]
if (!input) throw Error('Expected assigned artifact directory')
const root = resolve(import.meta.dirname, '..')
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const source = json(join(input, 'source.json'))
const packages = []
for (const row of source.copies) {
  if (!/^[\w.-]+\.tgz$/.test(row.name)) throw Error('Unsafe artifact filename')
  const file = join(input, row.name), bytes = readFileSync(file)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== row.sha256) throw Error('Handoff digest mismatch: ' + row.name)
  const files = await archiveFiles(bytes)
  const member = name => JSON.parse(files.get(name).toString())
  const pkg = member('package.json'), provenance = member('release-source.json')
  if (pkg.version !== provenance.version || !/^[a-f0-9]{40}$/.test(provenance.commit)) throw Error('Invalid provenance')
  const asset = row.name.replace(/\.tgz$/, '-' + sha256.slice(0, 12) + '.tgz')
  packages.push({ name: pkg.name, version: pkg.version, filename: row.name, asset, sha256, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'), repository: provenance.repository, commit: provenance.commit, provenance, pkg, file })
}
const manifests = ['package.json', 'apps/server/package.json', 'packages/shared/package.json', 'packages/component-runtime/package.json']
const lock = json(join(root, 'package-lock.json'))
for (const file of manifests) {
  const pkg = json(join(root, file))
  for (const section of ['dependencies', 'devDependencies']) for (const row of packages) {
    if (row.name !== '@voicechat/shared' && pkg[section]?.[row.name]) pkg[section][row.name] = 'file:' + (file === 'package.json' ? '' : '../../') + 'vendor/' + row.asset
  }
  save(join(root, file), pkg)
  const key = file === 'package.json' ? '' : file.replace('/package.json', '')
  for (const section of ['dependencies', 'devDependencies']) if (pkg[section]) lock.packages[key][section] = pkg[section]
}
for (const row of packages) {
  const target = join(root, 'vendor', row.asset)
  if (existsSync(target)) {
    if (createHash('sha256').update(readFileSync(target)).digest('hex') !== row.sha256) throw Error('Existing artifact differs')
  } else copyFileSync(row.file, target)
  const entry = lock.packages['node_modules/' + row.name] ?? (row.name === '@voicechat/shared' ? undefined : (lock.packages['node_modules/' + row.name] = { dev: true }))
  if (entry && !entry.link) {
    entry.version = row.version; entry.resolved = 'file:vendor/' + row.asset; entry.integrity = row.integrity
    for (const key of ['dependencies', 'peerDependencies', 'peerDependenciesMeta', 'engines', 'optionalDependencies', 'bin']) {
      if (row.pkg[key]) entry[key] = row.pkg[key]; else delete entry[key]
    }
  }
}
save(join(root, 'package-lock.json'), lock)
const rows = packages.map(({ pkg, file, ...row }) => row)
const inventory = json(join(root, 'vendor/owner-artifacts.json'))
for (const row of rows) {
  const index = inventory.packages.findIndex(item => item.name === row.name)
  if (index < 0) inventory.packages.push(row); else inventory.packages[index] = row
}
save(join(root, 'vendor/owner-artifacts.json'), inventory)
save(join(root, 'dependency-snapshots.json'), { schemaVersion: 1, purpose: 'shared-chat-s2-candidate', handoff: { repository: source.repository, commit: source.commit }, packages: rows })
