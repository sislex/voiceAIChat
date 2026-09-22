import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { buildApplicationFrontend, applicationFrontendDirectory } from './application-frontend.mjs'
const require = createRequire(import.meta.url)

test('Core accepts the owner manifest unchanged and rejects altered assets or provenance', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'vc-owner-panel-'))
  const pkg = join(repo, 'node_modules/@sislexa/make')
  try {
    mkdirSync(pkg, {recursive:true})
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({name:'@sislexa/make',exports:{'./frontend/*':'./frontend/*','./release-source.json':'./release-source.json'}}))
    cpSync(applicationFrontendDirectory('make-ui'),join(pkg,'frontend'),{recursive:true})
    cpSync(require.resolve('@sislexa/make/release-source.json'),join(pkg,'release-source.json'))
    const manifestPath = join(pkg, 'frontend/manifest.json')
    const original = readFileSync(manifestPath, 'utf8')
    const manifest = await buildApplicationFrontend('make-ui',{repo,version:'99.0.0',commit:'f'.repeat(40)})
    assert.equal(manifest.version,JSON.parse(original).version)
    assert.equal(readFileSync(manifestPath,'utf8'),original)
    const entry = join(dirname(manifestPath),manifest.entry.path)
    const bytes = readFileSync(entry)
    writeFileSync(entry,'unexpected replacement')
    await assert.rejects(buildApplicationFrontend('make-ui',{repo}),/integrity mismatch/)
    writeFileSync(entry,bytes)
    const sourcePath = join(pkg,'release-source.json')
    const source = JSON.parse(readFileSync(sourcePath,'utf8'))
    writeFileSync(sourcePath,JSON.stringify({...source,commit:'f'.repeat(40)}))
    await assert.rejects(buildApplicationFrontend('make-ui',{repo}),/provenance mismatch/)
  } finally { rmSync(repo,{recursive:true,force:true}) }
})
