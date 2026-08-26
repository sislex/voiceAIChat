import { describe, expect, it } from 'vitest'
import { isMakeTextPath, makeMimeType, normalizeMakePath } from './make'

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

describe('mime/text', () => {
  it('знает основные типы и умолчание', () => {
    expect(makeMimeType('a.html')).toMatch(/text\/html/)
    expect(makeMimeType('a.css')).toMatch(/text\/css/)
    expect(makeMimeType('a.bin')).toBe('application/octet-stream')
    expect(isMakeTextPath('a.js')).toBe(true)
    expect(isMakeTextPath('a.png')).toBe(false)
  })
})
