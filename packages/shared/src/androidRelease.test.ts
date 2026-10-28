import { describe, expect, it } from 'vitest'
import { parseAndroidReleaseManifest } from './androidRelease'
import { REST } from './protocol'

const pin = { schemaVersion: 1, android: {
  url: 'https://example.com/app.apk', filename: 'app.apk', sha256: 'a'.repeat(64),
  size: 123, commit: 'b'.repeat(40), minSdk: 26, abis: ['arm64-v8a'],
  versionName: '0.1.1', versionCode: 2
} }
describe('Android release contract', () => {
  it('retains update metadata and strips fields outside the public contract', () => {
    expect(parseAndroidReleaseManifest({ ...pin, secret: 'private', android: { ...pin.android, token: 'private' } })).toEqual(pin)
    expect(REST.androidApp).toBe('/api/app/android')
    expect(REST.androidApk).toBe('/api/app/android/apk')
  })
  it.each([
    { sha256: 'not-a-hash' }, { commit: 'short' }, { size: 0 }, { size: 1.5 },
    { versionCode: 0 }, { versionName: '' }, { minSdk: -1 }, { abis: [] },
    { filename: '../app.apk' }, { filename: 'app.apk"\r\nX-Test: injected' }
  ])('rejects invalid release metadata: %j', change => {
    expect(() => parseAndroidReleaseManifest({ ...pin, android: { ...pin.android, ...change } })).toThrow()
  })
})
