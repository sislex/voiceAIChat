import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fastify, { type FastifyInstance } from 'fastify'
import { chromium, type Browser, type Page } from 'playwright'
import { registerPreviewProxy } from '../apps/server/src/routes/previewProxy.js'

let app: FastifyInstance
let browser: Browser
let page: Page
let base: string
const site = 'http://modules-cycle.machine.internal:5173/'
const cases = [
  { name: 'комментарии не превращаются в запросы', code: '// import "./ghost.js"\nwindow.result = "ok";', expected: 'ok' },
  { name: 'строки с примерами импортов сохраняются', code: `window.result = "from './ghost.js'";`, expected: "from './ghost.js'" },
  { name: 'шаблонные строки с примерами сохраняются', code: 'window.result = `import "./ghost.js"`;', expected: 'import "./ghost.js"' },
  { name: 'комментарий внутри import не мешает загрузке', code: 'import /* comment */ "./dependency.js"; window.result = window.dependency;', expected: 'loaded' },
  { name: 'Unicode escape в имени модуля декодируется', code: String.raw`import './\u0064ependency.js'; window.result = window.dependency;`, expected: 'loaded' },
  { name: 'статический template в динамическом import загружается', code: 'await import(`./dependency.js`); window.result = window.dependency;', expected: 'loaded' },
  { name: 'абсолютный адрес модуля проходит через прокси', code: `import '${site}dependency.js'; window.result = window.dependency;`, expected: 'loaded' },
  { name: 'реэкспорт и import attributes сохраняют семантику', code: 'import { value } from "./reexport.js"; window.result = value;', expected: 'exported' },
  { name: 'имя из import map разрешается в модуль прокси', code: 'import "mapped"; window.result = window.dependency;', expected: 'loaded' },
  { name: 'ресурс рядом с модулем доступен через new URL', code: 'window.result = await fetch(new URL("./resource.txt", import.meta.url)).then(r => r.text());', expected: 'resource loaded' }
]

describe('Web Reader: цикл 02 в Chromium', () => {
  beforeAll(async () => {
    app = fastify()
    app.addHook('onRequest', async req => {
      ;(req as unknown as { user: { name: string; role: string } }).user = { name: 'reader-modules-e2e', role: 'user' }
    })
    registerPreviewProxy(app, { machines: { canUse: async () => true, bridge: {
      isOnline: () => true,
      http: async (_id, request) => {
        const index = Number(request.path.split('/')[1])
        const fixture = cases[index]
        const js = request.path.endsWith('.js')
        const body = request.path.endsWith('main.js') ? fixture!.code
          : request.path.endsWith('dependency.js') ? 'window.dependency = "loaded";'
          : request.path.endsWith('reexport.js') ? 'export { value } from "./value.js";'
          : request.path.endsWith('value.js') ? 'export const value = "exported";'
          : request.path.endsWith('resource.txt') ? 'resource loaded'
          : `<!doctype html><html><head><script type="importmap">{"imports":{"mapped":"./dependency.js"}}</script><script type="module" src="./main.js"></script></head><body><h1>Module ${index}</h1></body></html>`
        return { status: 200, headers: { 'content-type': js ? 'application/javascript' : request.path.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8' }, bodyBase64: Buffer.from(body).toString('base64') }
      }
    } } })
    base = await app.listen({ host: '127.0.0.1', port: 0 })
    browser = await chromium.launch()
    page = await browser.newPage()
    page.setDefaultTimeout(5_000)
  })
  afterAll(async () => { await browser?.close(); await app?.close() })
  it.each(cases.map((fixture, index) => ({ ...fixture, index })))('$name', async ({ index, expected }) => {
    await page.goto(base + '/api/preview?url=' + encodeURIComponent(site + index + '/'))
    await page.getByRole('heading', { name: `Module ${index}`, exact: true }).waitFor()
    await expect.poll(() => page.evaluate('window.result'), { timeout: 5_000 }).toBe(expected)
  })
})
