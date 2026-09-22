// Core consumes owner-built panels without compiling or relabelling their source.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APPLICATION_CATALOG } from '../packages/shared/src/applicationCatalog.ts'
import { parseApplicationFrontendManifest } from '../packages/shared/src/applicationFrontend.ts'
const root = resolve(import.meta.dirname, '..')
export function applicationFrontendDirectory(id, repo = root) {
  const app = APPLICATION_CATALOG.find(item => item.id === id && item.frontend)
  if (!app?.external) throw new Error(`No external frontend artifact: ${id}`)
  const require = createRequire(join(repo, 'package.json'))
  return dirname(require.resolve(`${app.external.package}/frontend/manifest.json`))
}
export async function buildApplicationFrontend(id, { repo = root } = {}) {
  const app = APPLICATION_CATALOG.find(item => item.id === id && item.frontend)
  const directory = applicationFrontendDirectory(id, repo)
  const manifest = parseApplicationFrontendManifest(
    JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')), id
  )
  const require = createRequire(join(repo, 'package.json'))
  const source = JSON.parse(readFileSync(require.resolve(`${app.external.package}/release-source.json`), 'utf8'))
  if (manifest.commit !== source.commit || manifest.version !== source.version)
    throw new Error(`Frontend source provenance mismatch: ${id}`)
  for (const asset of [manifest.entry, ...manifest.styles]) {
    const integrity = 'sha384-' + createHash('sha384')
      .update(readFileSync(join(directory, asset.path))).digest('base64')
    if (integrity !== asset.integrity) throw new Error(`Frontend integrity mismatch: ${id}/${asset.path}`)
  }
  console.log(`[frontend] ${id} ${manifest.version}: verified owner artifact`)
  return manifest
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const ids = process.argv.slice(2)
  for (const id of ids.length ? ids : APPLICATION_CATALOG.filter(app => app.frontend).map(app => app.id))
    await buildApplicationFrontend(id)
}
