import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { BROWSER_SCREENSHOT_HEADER, type BrowserCommand, type BrowserScreenshotMetadata, type BrowserScreenshotOptions, type BrowserSessionMetadata } from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import { buildBrowserRunner } from './server.js'
import { previewOriginTarget } from './security.js'

let completeFont: (() => void) | undefined
const site = createServer((req, res) => {
  if (req.url === '/slow.woff') {
    // Ресурс остаётся незавершённым до решения теста: нагрузка машины не
    // должна успеть освободить шрифт до начала проверяемого screenshot.
    completeFont = () => { res.writeHead(404); res.end() }
    return
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><title>Снимок Reader</title><style>
    body { margin:0; height:2400px; background:white }
    #tile {position:absolute;left:40px;top:900px;width:160px;height:90px;background:green}
    #moving {position:absolute;left:0;top:20px;width:50px;height:50px;background:red}
    @keyframes move {to{transform:translateX(200px)}}
    ${req.url === '/animated' ? '#moving{animation:move 2s linear forwards}' : ''}
    ${req.url === '/font' ? '@font-face{font-family:slow;src:url(/slow.woff)}body{font-family:slow}' : ''}
    </style><h1>Снимок Reader</h1><div id="moving"></div><div id="tile">Область</div>`)
})
let root = '', base = ''
let manager: BrowserSessionManager
let app: Awaited<ReturnType<typeof buildBrowserRunner>>
let meta: BrowserSessionMetadata
const request = (command: BrowserCommand) => ({ requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant' as const, command })
const command = (value: BrowserCommand) => manager.command(meta.id, request(value))
async function screenshot(options: BrowserScreenshotOptions = {}) {
  const response = await app.inject({ method: 'POST', url: `/v1/sessions/${meta.id}/commands`, headers: { authorization: 'Bearer shots' }, payload: request({ type: 'screenshot', ...options }) })
  const raw = response.headers[BROWSER_SCREENSHOT_HEADER]
  const metadata = typeof raw === 'string' ? JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as BrowserScreenshotMetadata : undefined
  return { response, metadata, pixels: () => ({ width: response.rawPayload.readUInt32BE(16), height: response.rawPayload.readUInt32BE(20) }) }
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vc-reader-shots-'))
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(site.address() as { port: number }).port}`
})
beforeEach(async () => {
  manager = new BrowserSessionManager(root, new Map(), previewOriginTarget(base))
  app = await buildBrowserRunner({ token: 'shots', profilesRoot: root, sessions: manager, idleMs: 0 })
  meta = await manager.start({ sessionId: 'shots', userKey: 'test', conversationKey: 'shots', viewport: { width: 640, height: 480, deviceScaleFactor: 2 } })
  await command({ type: 'navigate', url: base })
})
afterEach(async () => { completeFont?.(); completeFont = undefined; await app?.close() })
afterAll(async () => {
  site.closeAllConnections()
  await new Promise<void>(resolve => site.close(() => resolve()))
  if (root) await rm(root, { recursive: true, force: true })
})

it('область документа снимается с запрошенными размерами даже ниже viewport', async () => {
  const shot = await screenshot({ rect: { x: 40, y: 900, width: 160, height: 90 }, scale: 'css' })
  expect(shot.response.statusCode).toBe(200)
  expect(shot.pixels()).toEqual({ width: 160, height: 90 })
  expect(shot.metadata?.rect).toEqual({ x: 40, y: 900, width: 160, height: 90 })
})

it('вся страница включает содержимое ниже окна и сообщает его размер', async () => {
  const shot = await screenshot({ fullPage: true, scale: 'css' })
  expect(shot.response.statusCode).toBe(200)
  expect(shot.pixels().height).toBeGreaterThan(2000)
  expect(shot.metadata?.rect.height).toBe(shot.pixels().height)
})

it('контекст снимка берётся у снятой страницы с реальным заголовком', async () => {
  await command({ type: 'inspect', action: { kind: 'evaluate', code: 'document.title="Новый заголовок";history.replaceState(null,"","/#new");null' } })
  const shot = await screenshot()
  expect(shot.metadata?.page).toEqual({ url: `${base}/#new`, title: 'Новый заголовок' })
})

it('снимок элемента сообщает его координаты документа и размер', async () => {
  const shot = await screenshot({ selector: '#tile', scale: 'css' })
  expect(shot.response.statusCode).toBe(200)
  expect(shot.metadata?.rect).toEqual({ x: 40, y: 900, width: 160, height: 90 })
  expect(shot.pixels()).toEqual({ width: 160, height: 90 })
})

it('viewport после прокрутки не выдаётся за начало документа', async () => {
  await command({ type: 'selector', action: { kind: 'scroll', dy: 700 } })
  const shot = await screenshot({ scale: 'css' })
  expect(shot.metadata?.rect).toEqual({ x: 0, y: 700, width: 640, height: 480 })
})

it('CSS-масштаб оставляет изображение 1:1 с координатами модели при DPR 2', async () => {
  const shot = await screenshot({ scale: 'css' })
  expect(shot.pixels()).toEqual({ width: 640, height: 480 })
})

it('quality не ломает PNG по умолчанию', async () => {
  const shot = await screenshot({ quality: 82 })
  expect(shot.response.statusCode, shot.response.body.slice(0, 200)).toBe(200)
  expect(shot.response.headers['content-type']).toContain('image/png')
})

it('конфликтующие режимы явно отклоняются', async () => {
  expect((await screenshot({ selector: '#tile', fullPage: true })).response.statusCode).toBe(422)
})

it('отключение анимации завершает конечный переход перед снимком', async () => {
  await command({ type: 'navigate', url: `${base}/animated` })
  const shot = await screenshot({ animations: 'disabled', selector: '#moving', scale: 'css' })
  expect(shot.response.statusCode).toBe(200)
  expect(await command({ type: 'inspect', action: { kind: 'evaluate', code: 'document.querySelector("#moving").getBoundingClientRect().x' } })).toMatchObject({ value: 200 })
  expect(shot.metadata?.rect.x).toBe(200)
})

it('снимок не ждёт медленный шрифт дольше указанного времени', async () => {
  await command({ type: 'navigate', url: `${base}/font` })
  const shot = await screenshot({ timeoutMs: 100 })
  expect(shot.response.statusCode).toBe(422)
  expect(shot.response.body).toMatch(/timeout/i)
  completeFont?.(); completeFont = undefined
  expect((await screenshot({ timeoutMs: 1000 })).response.statusCode).toBe(200)
})
