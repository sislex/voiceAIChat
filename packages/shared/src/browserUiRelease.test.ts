import { describe, expect, it } from 'vitest'
import { BROWSER_UI_COMPATIBILITY, BROWSER_UI_REPOSITORY, browserUiAssetPath, parseBrowserUiRelease } from './browserUiRelease'
const release = () => ({ schemaVersion: 1, repository: BROWSER_UI_REPOSITORY, version: '1.0.0', commit: 'a'.repeat(40), id: '1.0.0-' + 'a'.repeat(40), dirty: false, requires: { coreApi: { min: '1.0.0', maxExclusive: '2.0.0' }, applicationHost: { min: '1.1.0', maxExclusive: '2.0.0' } }, files: { 'index.html': 'b'.repeat(64) } })
describe('independent browser release contract', () => {
  it('accepts the current API/host contract and rejects breaking or too-old hosts', () => {
    expect(parseBrowserUiRelease(release()).version).toBe('1.0.0')
    expect(() => parseBrowserUiRelease(release(), { ...BROWSER_UI_COMPATIBILITY, coreApi: '2.0.0' })).toThrow('Incompatible')
    expect(() => parseBrowserUiRelease(release(), { ...BROWSER_UI_COMPATIBILITY, applicationHost: '1.0.0' })).toThrow('Incompatible')
  })
  it.each(['../secret', '/etc/passwd', 'assets/../secret', 'assets//x', 'assets/%2e%2e/x', 'assets\\x', './index.html'])('rejects unsafe path %s', path => {
    expect(browserUiAssetPath(path)).toBe(false)
    expect(() => parseBrowserUiRelease({ ...release(), files: { ...release().files, [path]: 'a'.repeat(64) } })).toThrow()
  })
  it('requires immutable clean provenance and a complete entry manifest', () => {
    for (const patch of [{ dirty: true }, { id: 'latest' }, { commit: 'short' }, { repository: 'https://untrusted.test' }, { files: {} }, { files: { 'index.html': 'wrong' } }]) expect(() => parseBrowserUiRelease({ ...release(), ...patch })).toThrow()
  })
})
