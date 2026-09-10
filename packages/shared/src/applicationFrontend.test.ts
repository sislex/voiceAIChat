import { describe, expect, it } from 'vitest'
import { parseApplicationFrontendManifest } from './applicationFrontend'
const manifest = {
  schemaVersion: 1,
  applicationId: 'make-ui',
  version: '1.2.0',
  apiVersion: '1.0.0',
  commit: 'a'.repeat(40),
  host: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
  entry: { path: 'panel-abc.js', integrity: 'sha384-' + 'a'.repeat(64) },
  styles: [{ path: 'style-abc.css', integrity: 'sha384-' + 'b'.repeat(64) }]
}
describe('манифест frontend', () => {
  it('загружает новую панель без повышения API оболочки', () => {
    expect(parseApplicationFrontendManifest(manifest, 'make-ui').version).toBe(
      '1.2.0'
    )
    expect(() =>
      parseApplicationFrontendManifest(manifest, 'make-ui', '2.0.0')
    ).toThrow('API оболочки')
    expect(() =>
      parseApplicationFrontendManifest(manifest, 'make-ui', '0.9.0')
    ).toThrow('API оболочки')
  })
  it('отклоняет чужой код, выход из каталога и отсутствие целостности', () => {
    expect(() =>
      parseApplicationFrontendManifest(manifest, 'image-studio-ui')
    ).toThrow()
    for (const path of [
      '../panel.js',
      'assets/../panel.js',
      'https://other.test/panel.js',
      '//other.test/panel.js',
      '/panel.js',
      'panel%2f.js',
      'panel.html'
    ])
      expect(() =>
        parseApplicationFrontendManifest(
          { ...manifest, entry: { ...manifest.entry, path } },
          'make-ui'
        )
      ).toThrow()
    expect(() =>
      parseApplicationFrontendManifest(
        { ...manifest, entry: { ...manifest.entry, integrity: '' } },
        'make-ui'
      )
    ).toThrow()
    expect(() =>
      parseApplicationFrontendManifest(
        { ...manifest, styles: [manifest.styles[0], manifest.styles[0]] },
        'make-ui'
      )
    ).toThrow()
  })
})
it('локальная сборка без Git помечает неизвестный SHA явно', () => {
  expect(() =>
    parseApplicationFrontendManifest({ ...manifest, commit: null }, 'make-ui')
  ).toThrow()
  expect(
    parseApplicationFrontendManifest(
      { ...manifest, commit: null, development: true },
      'make-ui'
    ).commit
  ).toBeNull()
})
