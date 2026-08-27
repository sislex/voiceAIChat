import { describe, expect, it } from 'vitest'
import { detectPwaMeta, injectPwaIntoHtml, pwaFiles } from './makePwa'

describe('PWA-экспорт Make', () => {
  it('берёт название и цвет из index.html/css, иначе дефолты', () => {
    expect(detectPwaMeta('<title>Магазин</title><meta name="theme-color" content="#123456">', null)).toEqual({ title: 'Магазин', themeColor: '#123456' })
    expect(detectPwaMeta('<title>Сайт</title>', ':root { --accent: #abc; }')).toEqual({ title: 'Сайт', themeColor: '#abc' })
    expect(detectPwaMeta(null, null)).toEqual({ title: 'Проект Make', themeColor: '#4f7cff' })
  })

  it('файлы: для Vite в public/ с абсолютными путями, для статики — рядом', () => {
    const vite = pwaFiles({ title: 'Сайт', themeColor: '#000', vite: true })
    expect(Object.keys(vite).sort()).toEqual(['public/icon.svg', 'public/manifest.webmanifest', 'public/sw.js'])
    expect(JSON.parse(vite['public/manifest.webmanifest']!)).toMatchObject({ name: 'Сайт', start_url: '/', icons: [{ src: '/icon.svg' }] })
    const plain = pwaFiles({ title: 'Сайт', themeColor: '#000', vite: false })
    expect(JSON.parse(plain['manifest.webmanifest']!)).toMatchObject({ start_url: './index.html', icons: [{ src: 'icon.svg' }] })
    expect(plain['icon.svg']).toContain('>С<')
    expect(plain['sw.js']).toContain("caches.open(CACHE)")
  })

  it('инъекция в index.html идемпотентна и не дублирует уже имеющееся', () => {
    const html = '<!doctype html><html><head><title>A</title></head><body><p>x</p></body></html>'
    const once = injectPwaIntoHtml(html, { title: 'A', themeColor: '#111', vite: false })
    expect(once).toContain('<link rel="manifest" href="manifest.webmanifest">')
    expect(once).toContain('<meta name="theme-color" content="#111">')
    expect(once).toContain("serviceWorker.register('sw.js')")
    const twice = injectPwaIntoHtml(once, { title: 'A', themeColor: '#111', vite: false })
    expect(twice).toBe(once)
    expect(injectPwaIntoHtml(html, { title: 'A', themeColor: '#111', vite: true })).toContain('href="/manifest.webmanifest"')
  })
})
