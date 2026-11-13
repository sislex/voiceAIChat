// Verify published production bundles without rebuilding owner source in Core.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { archiveFiles } from './shared-chat-artifacts.mjs'
import { ensureVendorArchive, isVendorRef } from './vendor-store.mjs'
import { rowCommit, rowRepository } from './owner-release-publish.mjs'
import { verifyCoreUi } from './core-ui-artifact.mjs'
import { buildApplicationFrontend } from './application-frontend.mjs'
import { APPLICATION_CATALOG } from '../packages/shared/src/applicationCatalog.ts'

export const bundlePackages = ['@sislexa/core-ui', ...APPLICATION_CATALOG.filter(app => app.frontend && app.external).map(app => app.external.package)]
const inventories = ['dependency-snapshots.json', 'vendor/owner-artifacts.json', 'vendor/ui-libraries.json']
export async function checkOwnerBundles(names, repo = resolve(import.meta.dirname, '..')) {
  const json = path => JSON.parse(readFileSync(join(repo, path), 'utf8'))
  const rows = inventories.filter(file => existsSync(join(repo, file))).flatMap(file => json(file).packages)
  const lock = json('package-lock.json')
  for (const name of names) {
    if (!bundlePackages.includes(name)) throw Error(`No bundle compatibility adapter: ${name}`)
    const pins = rows.filter(row => row.name === name)
    if (!pins.length) throw Error(`Missing owner pin: ${name}`)
    const row = pins[0]
    if (!/^[a-f0-9]{64}$/.test(row.sha256) || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(row.integrity) || !/^[a-f0-9]{40}$/.test(rowCommit(row))) throw Error(`Invalid owner identity: ${name}`)
    for (const pin of pins) if (['version', 'asset', 'sha256', 'integrity'].some(key => pin[key] !== row[key]) || rowCommit(pin) !== rowCommit(row) || rowRepository(pin) !== rowRepository(row)) throw Error(`Conflicting owner pins: ${name}`)
    const bytes = await ensureVendorArchive(repo, row.asset, { sha256: row.sha256, integrity: row.integrity })
    const files = await archiveFiles(bytes)
    const pkg = JSON.parse(files.get('package.json'))
    const source = JSON.parse(files.get('release-source.json'))
    if (pkg.name !== name || pkg.version !== row.version || source.version !== row.version || source.commit !== rowCommit(row) || source.repository !== rowRepository(row) || source.dirty !== false) throw Error(`Archive provenance mismatch: ${name}`)
    const entry = lock.packages[`node_modules/${name}`]
    if (!entry || entry.version !== row.version || entry.integrity !== row.integrity || !isVendorRef(entry.resolved, row.asset)) throw Error(`Lock pin mismatch: ${name}`)
    const manifests = ['package.json']
    for (const parent of ['apps', 'packages']) if (existsSync(join(repo, parent)))
      for (const child of readdirSync(join(repo, parent))) manifests.push(`${parent}/${child}/package.json`)
    for (const file of manifests.filter(file => existsSync(join(repo, file)))) {
      const manifest = json(file)
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const spec = manifest[field]?.[name]
        if (spec && !isVendorRef(spec, row.asset)) throw Error(`Package pin mismatch: ${file}: ${name}`)
      }
    }
    // Bind installed compatibility/build checks to the verified bytes, including every asset.
    const directory = join(repo, 'node_modules', name)
    for (const [file, bytes] of files) if (!readFileSync(join(directory, file)).equals(bytes)) throw Error(`Installed artifact mismatch: ${name}/${file}`)
    if (name === '@sislexa/core-ui') verifyCoreUi(directory)
    for (const app of APPLICATION_CATALOG.filter(app => app.frontend && app.external?.package === name)) await buildApplicationFrontend(app.id, { repo })
    console.log(`[owner-pin] ${name}@${row.version}: checksum, provenance, contract and production bundle passed`)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  checkOwnerBundles(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
