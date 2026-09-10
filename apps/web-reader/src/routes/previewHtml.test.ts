// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, expect, it } from 'vitest'
import { rewritePreviewBody } from './previewProxy.js'

const base = new URL('https://project.example/app/')
const proxy = (value: string): string => '/api/preview?url=' + encodeURIComponent(new URL(value, base).href)
const rewrite = (html: string): string => rewritePreviewBody(Buffer.from(html), 'text/html', base).toString()
const doc = (html: string): Document => new DOMParser().parseFromString(rewrite(html), 'text/html')

describe('Web Reader: HTML реальных страниц', () => {
  it('декодирует entities до кодирования URL прокси', () => {
    expect(doc('<a href="/search?a=1&amp;b=2">Найти</a>').querySelector('a')?.getAttribute('href')).toBe(proxy('/search?a=1&b=2'))
  })
  it('переписывает URL без кавычек', () => {
    expect(doc('<img src=/logo.svg>').querySelector('img')?.getAttribute('src')).toBe(proxy('/logo.svg'))
  })
  it('сохраняет строки скриптов и комментарии, включая ложные head/body', () => {
    const script = `const template = '<a href="/x"></a></body><head>';`
    const html = `<html><head><script>${script}</script></head><body><!-- <img src="/x"> --></body></html>`
    expect(doc(html).querySelectorAll('script')[1]?.textContent).toBe(script)
    expect(rewrite(html)).toContain('<!-- <img src="/x"> -->')
  })
  it('не переписывает data-* атрибуты с URL-подобными именами', () => {
    const image = doc('<img data-src="/lazy.svg" data-href="/next" src="/logo.svg">').querySelector('img')!
    expect(image.getAttribute('data-src')).toBe('/lazy.svg')
    expect(image.getAttribute('data-href')).toBe('/next')
  })
  it('учитывает первый base href и удаляет base из документа прокси', () => {
    const page = doc('<base href="/assets/"><base href="/ignored/"><img src="logo.svg">')
    expect(page.querySelector('base')).toBeNull()
    expect(page.querySelector('img')?.getAttribute('src')).toBe(proxy('/assets/logo.svg'))
  })
  it('оставляет якоря переходом внутри текущего документа', () => {
    expect(doc('<a href="#section">Раздел</a>').querySelector('a')?.getAttribute('href')).toBe('#section')
  })
  it('переписывает индивидуальный адрес отправки кнопки формы', () => {
    expect(doc('<button formaction="/save">Сохранить</button>').querySelector('button')?.getAttribute('formaction')).toBe(proxy('/save'))
  })
  it('оставляет навигацию внутри Reader для всех способов записи target', () => {
    for (const target of ['_blank', '"_BLANK"', "'_parent'", '_top']) {
      expect(doc(`<a href="/next" target=${target}>Далее</a>`).querySelector('a')?.getAttribute('target')).toBe('_self')
    }
  })
  it('снимает устаревшую integrity у переписываемых ресурсов', () => {
    const page = doc('<link rel="stylesheet" href="/style.css" integrity="sha256-old"><script src="/app.js" integrity="sha256-old"></script>')
    expect(page.querySelectorAll('[integrity]')).toHaveLength(0)
  })
  it('направляет статические и динамические импорты inline module через прокси', () => {
    const page = doc('<script type="module">import "/app.js"; const next = () => import("./chunk.js");</script>')
    const code = page.querySelector('script[type=module]')?.textContent
    expect(code).toContain(`import "${proxy('/app.js')}"`)
    expect(code).toContain(`import("${proxy('./chunk.js')}")`)
  })
})
