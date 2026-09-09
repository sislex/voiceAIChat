// Настоящий Chromium: чистый разбор URL не замечает, что перехватчик повторно
// запрещает уже подставленный localhost, а JS/iframe остаются пустыми.
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isBrowserSessionMetadata, type BrowserCommand, type BrowserSessionMetadata } from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import { parseHostAliases, previewOriginTarget } from './security.js'
import { buildBrowserRunner } from './server.js'

let site: Server
let base = ''
let profilesRoot = ''
let manager: BrowserSessionManager
let meta: BrowserSessionMetadata
let slowResponses = 0
const pendingResponses = new Set<ReturnType<typeof setTimeout>>()

async function command(command: BrowserCommand) {
  const result = await manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant', command })
  if (isBrowserSessionMetadata(result)) meta = result
  return result
}

beforeAll(async () => {
  profilesRoot = await mkdtemp(join(tmpdir(), 'vc-reader-navigation-'))
  site = createServer((req, res) => {
    if (req.url === '/slow.png') {
      const timer = setTimeout(() => { pendingResponses.delete(timer); slowResponses++; res.end() }, 6000)
      pendingResponses.add(timer)
      return
    }
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end('fetch("/data").then(r => r.text()).then(t => document.getElementById("marker").textContent = t + location.hash)'); return }
    if (req.url === '/data') { res.end('PROJECT READY'); return }
    if (req.url === '/frame') { res.setHeader('content-type', 'text/html'); res.end('<title>Frame</title><p>Project frame</p>'); return }
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><title>Reader navigation fixture</title><h1>Project page</h1><p id="marker">Loading</p><script type="module" src="/app.js"></script><iframe src="/frame"></iframe>${req.url === '/slow' ? '<img src="/slow.png">' : ''}`)
  })
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
  const address = site.address()
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable')
  base = `http://127.0.0.1:${address.port}`
})

beforeEach(async () => {
  manager = new BrowserSessionManager(profilesRoot, new Map(), previewOriginTarget(base))
  meta = await manager.start({ sessionId: 'navigation', userKey: 'test', conversationKey: 'navigation' })
})
afterEach(async () => { await manager?.close() })

afterAll(async () => {
  await manager?.close()
  for (const timer of pendingResponses) clearTimeout(timer)
  if (site) { site.closeAllConnections(); await new Promise<void>(resolve => site.close(() => resolve())) }
  if (profilesRoot) await rm(profilesRoot, { recursive: true, force: true })
})

describe('страницы проекта в реальном Chromium', () => {
  it('открывает настроенный loopback origin с JS, fetch, iframe и hash-маршрутом', async () => {
    await command({ type: 'navigate', url: `${base}/#/projects/test` })
    await command({ type: 'selector', action: { kind: 'wait', text: 'PROJECT READY' } })
    const result = await command({ type: 'selector', action: { kind: 'read', selector: '#marker' } })
    expect(result).toMatchObject({ ok: true })
    expect(JSON.stringify(result)).toContain('PROJECT READY#/projects/test')
    expect(meta.currentUrl).toBe(`${base}/#/projects/test`)
  })

  it('открывает alias с loopback-целью и возвращает публичный hash-маршрут', async () => {
    await manager.close()
    manager = new BrowserSessionManager(profilesRoot, parseHostAliases(`reader.example.test=${new URL(base).host}`))
    meta = await manager.start({ sessionId: 'navigation', userKey: 'test', conversationKey: 'navigation' })
    await command({ type: 'navigate', url: 'http://reader.example.test/#/make/demo' })
    await command({ type: 'selector', action: { kind: 'wait', text: 'PROJECT READY' } })
    expect(meta.currentUrl).toBe('http://reader.example.test/#/make/demo')
    const result = await command({ type: 'selector', action: { kind: 'read', selector: '#marker' } })
    expect(JSON.stringify(result)).toContain('PROJECT READY#/make/demo')
  })

  it('ошибочный selectTab не меняет активную вкладку', async () => {
    const previous = meta.activeTabId
    if (!previous) throw new Error('Initial tab missing')
    await expect(command({ type: 'selectTab', tabId: 'missing-tab' })).rejects.toThrow('stale_tab')
    await command({ type: 'selectTab', tabId: previous })
    expect(meta.activeTabId).toBe(previous)
    await command({ type: 'newTab' })
    expect(meta.activeTabId).not.toBe(previous)
  })

  it('разрешает открыть новую вкладку после закрытия всех прежних', async () => {
    for (const tab of [...meta.tabs]) await command({ type: 'closeTab', tabId: tab.id })
    await command({ type: 'newTab' })
    expect(meta.tabs).toHaveLength(1)
    expect(meta.activeTabId).toBe(meta.tabs[0].id)
  })

  it('новая вкладка готова после DOM, не ждёт зависший необязательный ресурс', async () => {
    const before = slowResponses
    await command({ type: 'newTab', url: `${base}/slow` })
    expect(slowResponses).toBe(before)
    expect(meta.title).toBe('Reader navigation fixture')
  }, 15_000)

  it('история и перезагрузка также не ждут необязательные ресурсы', async () => {
    await command({ type: 'navigate', url: `${base}/slow` })
    await command({ type: 'navigate', url: `${base}/next` })
    const before = slowResponses
    await command({ type: 'back' })
    expect(meta.currentUrl).toBe(`${base}/slow`)
    await command({ type: 'reload' })
    await command({ type: 'forward' })
    expect(meta.currentUrl).toBe(`${base}/next`)
    expect(slowResponses).toBe(before)
  }, 15_000)

  it('передаёт JPEG с его MIME-типом и настоящей JPEG-сигнатурой', async () => {
    const app = await buildBrowserRunner({ token: 'navigation-test-token', profilesRoot, sessions: manager, idleMs: 0 })
    try {
      const result = await app.inject({ method: 'POST', url: `/v1/sessions/${meta.id}/commands`, headers: { authorization: 'Bearer navigation-test-token' }, payload: {
        requestId: randomUUID(), incarnation: meta.incarnation, actor: 'user', command: { type: 'screenshot', format: 'jpeg', quality: 82 }
      } })
      expect(result.statusCode).toBe(200)
      expect(result.headers['content-type']).toContain('image/jpeg')
      expect([...result.rawPayload.subarray(0, 3)]).toEqual([255, 216, 255])
    } finally { await app.close() }
  })
})
