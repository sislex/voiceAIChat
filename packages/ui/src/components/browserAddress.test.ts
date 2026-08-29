// Схема для адреса, набранного без протокола.
//
// До круга 11 подставлялся `https://` всему подряд: набранный `89.125.68.35:8787`
// (наш стенд по http) превращался в адрес, который не открывается.
import { describe, expect, it } from 'vitest'
import { withScheme } from './BrowserSessionPane'

describe('withScheme', () => {
  it('готовый адрес не трогает', () => {
    expect(withScheme('http://89.125.68.35:8787/#/login')).toBe('http://89.125.68.35:8787/#/login')
    expect(withScheme('https://example.com')).toBe('https://example.com')
  })
  it('явный порт означает http: так выглядят стенды', () => {
    expect(withScheme('89.125.68.35:8787')).toBe('http://89.125.68.35:8787')
    expect(withScheme('89.125.68.35:8787/#/projects')).toBe('http://89.125.68.35:8787/#/projects')
  })
  it('имя без порта остаётся https', () => {
    expect(withScheme('example.com')).toBe('https://example.com')
    expect(withScheme('example.com/path')).toBe('https://example.com/path')
  })
  it('пробелы по краям срезаются', () => {
    expect(withScheme('  example.com  ')).toBe('https://example.com')
  })
})
