import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, expect, it } from 'vitest'
import { REST } from '@voicechat/shared'
import { setupRestHarness } from './restHarness.js'

const directory = mkdtempSync(join(tmpdir(), 'android-core-'))
const bytes = Buffer.from('Core APK fixture')
const pin = join(directory, 'android-release.json')
writeFileSync(join(directory, 'app.apk'), bytes)
writeFileSync(pin, JSON.stringify({ schemaVersion: 1, android: {
  url: 'https://example.com/app.apk', filename: 'app.apk',
  sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
  commit: 'a'.repeat(40), minSdk: 26, abis: ['arm64-v8a'], versionName: '1.0.0', versionCode: 1
} }))
const harness = setupRestHarness({ env: { VC_ANDROID_MANIFEST: pin } })
afterAll(() => { rmSync(directory, { recursive: true, force: true }) })
it('serves the configured Android release publicly through the real Core auth stack', async () => {
  expect((await harness.app.inject(REST.androidApp)).json().android.url).toBe(REST.androidApk)
  const response = await harness.app.inject(REST.androidApk)
  expect(response.statusCode).toBe(200)
  expect(response.rawPayload).toEqual(bytes)
  expect((await harness.app.inject('/api/agents')).statusCode).toBe(401)
})
