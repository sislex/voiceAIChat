import Fastify from 'fastify'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { registerMakeLocalization, requestMakeLocale } from './localization.js'
import { renderGalleryPage, renderStoriesPage, renderTestsPage } from './stories.js'

const apps: ReturnType<typeof Fastify>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())) })

it('uses explicit locale before the saved choice and browser preferences', () => {
  expect(requestMakeLocale({ url: '/p/a/?makeLocale=ru', headers: { cookie: 'vc_make_locale=en', 'accept-language': 'en' } })).toBe('ru')
  expect(requestMakeLocale({ url: '/api/make/a', headers: { cookie: 'other=x; vc_make_locale=en', 'accept-language': 'ru' } })).toBe('en')
  expect(requestMakeLocale({ url: '/p/a/?makeLocale=malformed', headers: { cookie: 'vc_make_locale=malformed', 'accept-language': 'en-US' } })).toBe('en')
})

it('localizes Make errors and check results without changing codes, other applications, or mock payloads', async () => {
  const app = Fastify(); apps.push(app)
  registerMakeLocalization(app)
  app.get('/api/make/:id/file', (_, reply) => reply.code(404).header('vary', 'Origin').send({ error: 'Файл «страница.html» не найден', code: 'not_found' }))
  app.get('/api/make/:id/check', () => ({ issues: [{ path: 'app.js', message: 'Используйте const/let вместо var' }] }))
  app.get('/api/other', (_, reply) => reply.code(404).send({ error: 'Файл «страница.html» не найден' }))
  app.get('/api/preview/make/:id/api/test', (_, reply) => reply.code(400).header('x-vc-mock', '1').send({ error: 'Файл «страница.html» не найден' }))
  const headers = { 'accept-language': 'en' }
  const missing = await app.inject({ url: '/api/make/a/file', headers })
  expect(missing.statusCode).toBe(404)
  expect(missing.json()).toEqual({ error: 'File “страница.html” not found', code: 'not_found' })
  expect(missing.headers['content-language']).toBe('en')
  expect(missing.headers.vary).toBe('Origin, Accept-Language, Cookie')
  expect((await app.inject({ url: '/api/make/a/check', headers })).json().issues[0]).toEqual({ path: 'app.js', message: 'Use const/let instead of var' })
  expect((await app.inject({ url: '/api/other', headers })).json().error).toBe('Файл «страница.html» не найден')
  expect((await app.inject({ url: '/api/preview/make/a/api/test', headers })).json().error).toBe('Файл «страница.html» не найден')
})

it('localizes gallery and runner chrome while retaining project markup', () => {
  const gallery = renderGalleryPage([], '/', undefined, {}, 'en')
  expect(gallery).toContain('<html lang="en">')
  expect(gallery).toContain('The project has no stories yet')
  expect(gallery).toContain('Interface language')
  const source = '<link rel="stylesheet" href="/стили.css">'
  expect(renderStoriesPage('Кнопка.stories.tsx', 'Primary', source, 'en')).toContain('The file has no named story exports')
  expect(renderStoriesPage('Кнопка.stories.tsx', 'Primary', source, 'en')).toContain('/стили.css')
  expect(renderTestsPage('test.tsx', null, 'en')).toContain('click: element not found')
  expect(renderGalleryPage([], '/')).toContain('В проекте пока нет сториз')
})

it('executes localized runner assertions with intact actual and expected values', () => {
  for (const locale of ['ru', 'en'] as const) {
    const html = renderTestsPage('sample.test.tsx', null, locale)
    const assertions = html.slice(html.indexOf('const fmt ='), html.indexOf('const sleep ='))
    const host = { expect: undefined as unknown as (value: unknown) => { toBe: (value: unknown) => void; toHaveClass: (name: string) => void } }
    runInNewContext(assertions, { window: host })
    expect(() => host.expect('actual').toBe('expected')).toThrow(locale === 'ru' ? 'Ожидалось: "actual" toBe "expected"' : 'Expected: "actual" toBe "expected"')
    expect(() => host.expect(null).toHaveClass('my-class')).toThrow(locale === 'ru' ? 'Ожидался элемент с классом my-class' : 'Expected an element with class my-class')
    expect(() => host.expect('unchanged').toBe('unchanged')).not.toThrow()
  }
})
