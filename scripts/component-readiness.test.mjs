import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyComponentReadiness } from './component-readiness.mjs'
test('deployment requires readiness of Core and each configured dependency', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sislexa-readiness-')), configFile = join(root, 'config.json')
  try {
    writeFileSync(configFile, JSON.stringify({ dependencies: [{ applicationId: 'make', url: 'http://make:8788', tokenFile: '/private/secret' }] }))
    let fail = true
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push(url); assert.equal(init.redirect, 'error'); assert.equal(init.headers, undefined)
      return Response.json({ ok: !(fail && url.includes('make')) }, { status: fail && url.includes('make') ? 503 : 200 })
    }
    const failed = await verifyComponentReadiness({ configFile, fetchImpl })
    assert.equal(failed.ready, false); assert.equal(JSON.stringify(failed).includes('/private/secret'), false)
    assert.deepEqual(calls, ['http://127.0.0.1:8787/v1/ready', 'http://make:8788/v1/ready'])
    fail = false
    assert.equal((await verifyComponentReadiness({ configFile, fetchImpl })).ready, true)
    assert.deepEqual(await verifyComponentReadiness({}), { managed: false, ready: true })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
