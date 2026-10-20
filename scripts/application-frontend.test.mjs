import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { buildApplicationFrontend, applicationFrontendDirectory } from './application-frontend.mjs'
const require = createRequire(import.meta.url)
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value))

function fixture(t, id = 'web-reader-ui') {
  const owner = id.slice(0, -3)
  const repo = mkdtempSync(join(tmpdir(), 'vc-owner-panel-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  writeJson(join(repo, 'package.json'), { private: true })
  const source = require.resolve(`@sislexa/${owner}/release-source.json`)
  const originalPackage = dirname(source)
  const originalFrontend = applicationFrontendDirectory(id)
  const pkg = join(repo, 'node_modules', '@sislexa', owner)
  const frontend = join(pkg, relative(originalPackage, originalFrontend))
  mkdirSync(dirname(frontend), { recursive: true })
  cpSync(join(originalPackage, 'package.json'), join(pkg, 'package.json'))
  cpSync(source, join(pkg, 'release-source.json'))
  cpSync(join(dirname(originalFrontend), 'package.json'), join(dirname(frontend), 'package.json'))
  cpSync(originalFrontend, frontend, { recursive: true })
  return {
    repo, id, frontend,
    ownerPackage: join(pkg, 'package.json'),
    source: join(pkg, 'release-source.json'),
    uiPackage: join(dirname(frontend), 'package.json'),
    manifest: join(frontend, 'manifest.json')
  }
}

function independentVersions(files) {
  writeJson(files.ownerPackage, { ...json(files.ownerPackage), version: '1.3.3' })
  writeJson(files.source, { ...json(files.source), version: '1.3.3' })
  writeJson(files.uiPackage, { ...json(files.uiPackage), version: '1.3.1' })
  writeJson(files.manifest, { ...json(files.manifest), version: '1.3.1' })
}

test('Core verifies all four published owner frontend layouts without rewriting metadata', async t => {
  for (const id of ['make-ui', 'image-studio-ui', 'playwright-reader-ui', 'web-reader-ui']) {
    await t.test(id, async t => {
      const files = fixture(t, id)
      const paths = [files.ownerPackage, files.source, files.uiPackage, files.manifest]
      const original = paths.map(path => readFileSync(path, 'utf8'))
      const manifest = await buildApplicationFrontend(id, {
        repo: files.repo, version: '99.0.0', commit: 'f'.repeat(40)
      })
      assert.deepEqual(manifest, JSON.parse(original[3]))
      assert.deepEqual(paths.map(path => readFileSync(path, 'utf8')), original)
    })
  }
})

test('Core accepts independently versioned owner and frontend packages', async t => {
  const files = fixture(t)
  independentVersions(files)
  const original = readFileSync(files.manifest, 'utf8')
  const manifest = await buildApplicationFrontend(files.id, { repo: files.repo })
  assert.equal(json(files.ownerPackage).version, '1.3.3')
  assert.equal(json(files.source).version, '1.3.3')
  assert.equal(manifest.version, '1.3.1')
  assert.equal(readFileSync(files.manifest, 'utf8'), original)
})

test('Core rejects invalid owner, frontend and commit provenance even with independent versions', async t => {
  const cases = [
    ['owner package name', files => {
      writeJson(files.ownerPackage, { ...json(files.ownerPackage), name: '@sislexa/other' })
    }],
    ['owner package version', files => {
      writeJson(files.ownerPackage, { ...json(files.ownerPackage), version: '1.3.4' })
    }],
    ['source version', files => {
      writeJson(files.source, { ...json(files.source), version: '1.3.4' })
    }],
    ['both owner versions absent', files => {
      for (const path of [files.ownerPackage, files.source]) {
        const value = json(path)
        delete value.version
        writeJson(path, value)
      }
    }],
    ['both owner versions malformed', files => {
      for (const path of [files.ownerPackage, files.source]) {
        writeJson(path, { ...json(path), version: 'next' })
      }
    }],
    ['frontend package version', files => {
      writeJson(files.uiPackage, { ...json(files.uiPackage), version: '1.3.2' })
    }],
    ['frontend manifest version', files => {
      writeJson(files.manifest, { ...json(files.manifest), version: '1.3.2' })
    }],
    ['source commit', files => {
      writeJson(files.source, { ...json(files.source), commit: 'f'.repeat(40) })
    }],
    ['frontend commit', files => {
      writeJson(files.manifest, { ...json(files.manifest), commit: 'f'.repeat(40) })
    }]
  ]
  for (const [name, mutate] of cases) {
    await t.test(name, async t => {
      const files = fixture(t)
      independentVersions(files)
      mutate(files)
      await assert.rejects(buildApplicationFrontend(files.id, { repo: files.repo }), /provenance mismatch/)
    })
  }
})

test('Core rejects altered entry and stylesheet bytes with independent versions', async t => {
  for (const kind of ['entry', 'stylesheet']) {
    await t.test(kind, async t => {
      const files = fixture(t)
      independentVersions(files)
      const manifest = json(files.manifest)
      const asset = kind === 'entry' ? manifest.entry : manifest.styles[0]
      assert.ok(asset, `Published Web Reader fixture must contain a ${kind}`)
      writeFileSync(join(files.frontend, asset.path), 'unexpected replacement')
      await assert.rejects(buildApplicationFrontend(files.id, { repo: files.repo }), /integrity mismatch/)
    })
  }
})
