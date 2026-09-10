import { describe, expect, it } from 'vitest'
import { browserUrlMatches, browserWaitRequiresChromium, isBrowserWaitOptions } from './browserWaiting'

describe('контракт ожидания браузера', () => {
  it('сохраняет false, пустое значение и нулевое число элементов', () => {
    for (const options of [{ selector: '#x' }, { selector: '#x', enabled: false }, { selector: '#x', value: '' }, { selector: '.row', count: 0 }, { url: '**/ready' }, { loadState: 'load' }, { predicate: 'window.appReady', timeoutMs: 30000 }]) {
      expect(isBrowserWaitOptions(options)).toBe(true)
    }
  })

  it('отклоняет некорректные и противоречивые условия до обращения к браузеру', () => {
    for (const options of [null, {}, { selector: '' }, { selector: '#x', state: ['visible'] }, { selector: '#x', state: 'missing' }, { loadState: 'networkidle' }, { checked: true }, { value: '' }, { selector: '.row', count: -1 }, { selector: '.row', count: 1.5 }, { selector: '.row', count: 0, state: 'visible' }, { selector: '.row', count: 0, enabled: true }, { selector: '.row', count: 1, state: 'detached' }, { selector: '#x', timeoutMs: Infinity }, { selector: '#x', timeoutMs: 30001 }, { predicate: 'x'.repeat(4001) }]) {
      expect(isBrowserWaitOptions(options)).toBe(false)
    }
  })

  it('отличает прежний iframe wait от расширенного Chromium-ожидания', () => {
    expect(browserWaitRequiresChromium({ selector: '#x', timeoutMs: 5000 })).toBe(false)
    expect(browserWaitRequiresChromium({ text: 'Готово' })).toBe(false)
    for (const options of [{ selector: '#x', text: 'Готово' }, { selector: '#x', checked: false }, { selector: '#x', value: '' }, { selector: '.row', count: 0 }, { selector: '#x', timeoutMs: 10000 }, { url: '**/ready' }]) {
      expect(browserWaitRequiresChromium(options)).toBe(true)
    }
  })

  it('шаблон URL сохраняет буквальные query-символы и нормализует origin', () => {
    expect(browserUrlMatches('https://EXAMPLE.com:443/path?a=1', 'https://example.com/path?a=1')).toBe(true)
    expect(browserUrlMatches('https://example.com/a/path#ready', '**/path#ready')).toBe(true)
    expect(browserUrlMatches('https://example.com/a/path#loading', '**/path#ready')).toBe(false)
    expect(browserUrlMatches('https://example.com/?x=a.b', 'https://example.com/?x=a.b')).toBe(true)
    expect(browserUrlMatches('https://example.com/?x=axb', 'https://example.com/?x=a.b')).toBe(false)
    expect(browserUrlMatches('about:blank', '*')).toBe(true)
  })
})
