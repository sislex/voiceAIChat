import { describe, expect, it } from 'vitest'
import { MAKE_BOOTSTRAP_CSS_URL, MAKE_BOOTSTRAP_JS_URL, MAKE_STACK_HINTS, MAKE_STACKS, MAKE_UI_KIT_HINTS, MAKE_UI_KITS, isMakeTextPath, makeMimeType, makeScaffold, normalizeMakePath } from './make'

describe('normalizeMakePath', () => {
  it('принимает обычные пути и приводит разделители', () => {
    expect(normalizeMakePath('index.html')).toBe('index.html')
    expect(normalizeMakePath('./css/app.css')).toBe('css/app.css')
    expect(normalizeMakePath('/img\\logo.svg')).toBe('img/logo.svg')
    expect(normalizeMakePath('  src/main.js  ')).toBe('src/main.js')
    expect(normalizeMakePath('my page.html')).toBe('my page.html')
  })

  it('отклоняет выход за корень, скрытые и служебные сегменты, мусор', () => {
    for (const bad of ['', '../x', 'a/../b', 'a//b', '.snapshots/x', '.git/config', 'dir/', 'a:b', 'a?b', 'a/./b', 'x'.repeat(121), 'a/b/c/d/e/f/g/h/i', 'a\u0001b'])
      expect(normalizeMakePath(bad)).toBeNull()
  })
})

describe('stack settings', () => {
  // @testCase TC-02
  it('has exhaustive stack and UI kit hints', () => {
    for (const stack of MAKE_STACKS) expect(MAKE_STACK_HINTS[stack].trim()).not.toBe('')
    for (const uiKit of MAKE_UI_KITS) expect(MAKE_UI_KIT_HINTS[uiKit].trim()).not.toBe('')
  })

  // @testCase TC-08
  it('builds the Bootstrap scaffold matrix without JavaScript for html', () => {
    for (const stack of MAKE_STACKS) {
      const files = makeScaffold(stack, 'bootstrap')
      expect(files['index.html']).toContain(MAKE_BOOTSTRAP_CSS_URL)
      if (stack === 'html') {
        expect(files['index.html']).not.toContain('<script')
        expect(Object.keys(files).some((path) => /\\.(?:js|mjs)$/.test(path))).toBe(false)
      } else expect(files['index.html']).toContain(MAKE_BOOTSTRAP_JS_URL)
    }
  })
})

describe('mime/text', () => {
  it('знает основные типы и умолчание', () => {
    expect(makeMimeType('a.html')).toMatch(/text\/html/)
    expect(makeMimeType('a.css')).toMatch(/text\/css/)
    expect(makeMimeType('a.bin')).toBe('application/octet-stream')
    expect(isMakeTextPath('a.js')).toBe(true)
    expect(isMakeTextPath('a.png')).toBe(false)
  })
})
