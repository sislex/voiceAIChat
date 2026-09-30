import { describe, expect, it } from 'vitest'
import { parsePublishedApplicationRelease, releasePackageAsset, releaseTag } from './releaseComposition'

const sha = 'f'.repeat(64)
const valid = {
  schemaVersion: 1, repository: 'https://github.com/sislex/make', version: '1.3.1', commit: 'e'.repeat(40),
  packages: [{ name: '@sislexa/make', version: '1.3.1', asset: releasePackageAsset('@sislexa/make', '1.3.1', sha), sha256: sha, integrity: 'sha512-' + 'A'.repeat(86) + '==', size: 10 }],
  images: [{ name: 'ghcr.io/sislex/make-api' }], tools: ['make']
}

describe('sislexa-release.json', () => {
  it('принимает опубликованный выпуск и именует архив хэшем', () => {
    expect(parsePublishedApplicationRelease(valid)).toEqual(valid)
    expect(valid.packages[0]!.asset).toBe('sislexa-make-1.3.1-ffffffffffff.tgz')
    expect(releaseTag('1.3.1')).toBe('v1.3.1')
  })

  it.each([
    ['версия не semver', { version: '1.3' }],
    ['короткий коммит', { commit: 'e43736e' }],
    ['чужой хост репозитория', { repository: 'https://example.com/sislex/make' }],
    ['образ не из GHCR', { images: [{ name: 'docker.io/sislex/make-api' }] }],
    ['пакет дважды', { packages: [valid.packages[0], valid.packages[0]] }],
    ['архив другого пакета', { packages: [{ ...valid.packages[0], asset: 'sislexa-voice-1.3.1-ffffffffffff.tgz' }] }],
    ['нет пакетов', { packages: [] }],
    ['другая схема', { schemaVersion: 2 }]
  ])('отклоняет: %s', (_name, patch) => {
    expect(() => parsePublishedApplicationRelease({ ...valid, ...patch })).toThrow(/sislexa-release.json/)
  })
})
