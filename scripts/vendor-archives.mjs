// Shared archive reachability for repository checks and post-pin cleanup.
import { readdirSync, readFileSync, statSync, lstatSync, unlinkSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { vendorAssetFromRef } from './vendor-store.mjs'

const inventories = ['vendor/owner-artifacts.json', 'vendor/ui-libraries.json', 'dependency-snapshots.json']
function walk(root, dir = '') {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const file = join(dir, entry.name)
    if (entry.isSymbolicLink()) throw Error('Cannot safely analyze symlink: ' + file)
    if (entry.isDirectory()) return ['.git', 'node_modules'].includes(entry.name) ? [] : walk(root, file)
    return [file]
  })
}

function repositoryFiles(root) {
  if (existsSync(join(root, '.git'))) {
    return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))]
  }
  return walk(root)
}

export function vendorArchives(root) {
  return existsSync(join(root, 'vendor')) ? walk(root, 'vendor').filter(file => file.endsWith('.tgz')).sort() : []
}

/** Read every source before deciding on deletion; parse/read failures are fatal. */
export function analyzeVendorArchives(root) {
  root = resolve(root)
  const archives = vendorArchives(root)
  const references = new Map(archives.map(file => [file, []]))
  const add = (target, source) => {
    const file = relative(root, target)
    if (references.has(file) && !references.get(file).includes(source)) references.get(file).push(source)
  }
  const files = repositoryFiles(root)
  const manifests = files.filter(file => /(^|\/)package(-lock)?\.json$/.test(file))
  const scripts = files.filter(file => file.startsWith('scripts/'))
  const sources = [...new Set([...manifests, ...inventories.filter(file => files.includes(file) || existsSync(join(root, file))), ...scripts])]
  for (const file of sources) {
    if (lstatSync(join(root, file)).isSymbolicLink()) throw Error('Cannot safely analyze symlink: ' + file)
    const text = readFileSync(join(root, file), 'utf8')
    if (file.endsWith('.json')) {
      const value = JSON.parse(text)
      if (manifests.includes(file) && (!value || typeof value !== 'object' || Array.isArray(value))) throw Error('Invalid package manifest: ' + file)
      if (inventories.includes(file)) {
        if (!Array.isArray(value.packages)) throw Error('Invalid packages manifest: ' + file)
        for (const row of value.packages) {
          // Consumers open asset, not the upstream publication filename.
          if (typeof row.asset === 'string') add(resolve(root, 'vendor', row.asset), file + ':asset')
        }
      }
      const visit = value => {
        if (typeof value === 'string' && value.startsWith('file:')) add(resolve(root, dirname(file), value.slice(5)), file)
        else if (typeof value === 'string' && vendorAssetFromRef(value)) add(resolve(root, 'vendor', vendorAssetFromRef(value)), file)
        else if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object') Object.values(value).forEach(visit)
      }
      visit(value)
    }
    if (file.startsWith('scripts/')) {
      // Literal filenames also cover join(root, 'vendor', 'name.tgz').
      const tokens = text.match(/(?:[\w.@+-]+\/)*[\w.@+-]+\.tgz(?![\w.-])/g) ?? []
      for (const token of tokens) {
        const vendorIndex = token.indexOf('vendor/')
        if (vendorIndex >= 0) add(resolve(root, token.slice(vendorIndex)), file)
        else if (!token.includes('/')) add(resolve(root, 'vendor', token), file)
      }
    }
  }
  const rows = archives.map(file => ({ file, bytes: statSync(join(root, file)).size, sources: references.get(file).sort() }))
  return { archives: rows, unused: rows.filter(row => !row.sources.length) }
}

export function assertVendorArchivesUsed(root) {
  const report = analyzeVendorArchives(root)
  if (report.unused.length) throw Error('Unused vendor archives:\n' + report.unused.map(row => row.file).join('\n'))
  return report
}

/** Candidates are captured before pinning; new files can never be swept by cleanup. */
export function removeUnusedVendorArchives(root, candidates) {
  const report = analyzeVendorArchives(root)
  const selected = new Set(candidates)
  const removed = report.unused.filter(row => selected.has(row.file))
  for (const row of removed) unlinkSync(join(root, row.file))
  return removed
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..')
  const report = analyzeVendorArchives(root)
  if (process.argv.includes('--clean')) {
    const removed = removeUnusedVendorArchives(root, report.unused.map(row => row.file))
    console.log(JSON.stringify({ removed, bytes: removed.reduce((sum, row) => sum + row.bytes, 0) }, null, 2))
  } else if (process.argv.includes('--report')) console.log(JSON.stringify(report, null, 2))
  else assertVendorArchivesUsed(root)
}
