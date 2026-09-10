import { mkdtemp, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium, type BrowserContext } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { BrowserCommand, BrowserInspectResult, BrowserSessionMetadata } from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import { profilePath } from './security.js'
import { startReaderProfileFixture } from './test/readerProfile.js'

let site: Awaited<ReturnType<typeof startReaderProfileFixture>>, root = '', manager: BrowserSessionManager, meta: BrowserSessionMetadata, sequence = 0
const contexts: BrowserContext[] = []
const ROOT = 'http://profile.reader.test/', OTHER = 'http://other-profile.reader.test/'
const request = () => ({ sessionId: `profile-${sequence}`, userKey: 'test', conversationKey: `profile-${sequence}`, profileMode: 'persistent' as const, cookies: [{ name: 'vc_preview_run', value: 'fixture-only', url: site.origin }] })
const send = (command: BrowserCommand) => manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant', command })
const state = async () => (await send({ type: 'inspect', action: { kind: 'evaluate', code: 'window.profileState()' } }) as BrowserInspectResult).value as { cookies: { session: boolean; persistent: boolean; path: boolean; bootstrap: boolean }; local: string | null; session: string | null; databases: string[]; caches: string[]; workers: number }
async function ready() { meta = await manager.start(request()); await send({ type: 'navigate', url: ROOT }) }
async function login() { await send({ type: 'selector', action: { kind: 'click', selector: '#login' } }); await send({ type: 'selector', action: { kind: 'wait', text: 'Тестовый вход сохранён' } }) }

beforeAll(async () => {
  site = await startReaderProfileFixture(); root = await mkdtemp(join(tmpdir(), 'vc-reader-profiles-'))
  const launch = chromium.launchPersistentContext.bind(chromium)
  // Регрессия старого stop/start теряла context из Map. Стенд всё равно
  // закрывает его, чтобы красный тест не оставлял процесс Chromium.
  vi.spyOn(chromium, 'launchPersistentContext').mockImplementation(async (...args) => { const context = await launch(...args); contexts.push(context); return context })
})
beforeEach(() => { sequence++; manager = new BrowserSessionManager(root, new Map([['profile.reader.test', new URL(site.origin).host], ['other-profile.reader.test', new URL(site.otherOrigin).host]])) })
afterEach(async () => { await manager.close(); await Promise.allSettled(contexts.splice(0).map(context => context.close())) })
afterAll(async () => { vi.restoreAllMocks(); await site?.close(); if (root) await rm(root, { recursive: true, force: true }) })

it('профиль Reader сохраняет localStorage, IndexedDB и CacheStorage после остановки', async () => {
  await ready(); await login(); await manager.stop(meta.id); meta = await manager.start(request())
  await send({ type: 'navigate', url: ROOT })
  expect(await state()).toMatchObject({ local: 'test-user', databases: ['reader-auth'], caches: ['reader-cache'] })
})
it('сессионные HttpOnly-cookie и cookie отдельного path переживают остановку', async () => {
  await ready(); await login(); await manager.stop(meta.id); meta = await manager.start(request())
  await send({ type: 'navigate', url: ROOT })
  expect((await state()).cookies).toMatchObject({ session: true, persistent: true, path: true })
})
it('последний публичный адрес восстанавливается без ручной навигации', async () => {
  await ready(); await send({ type: 'navigate', url: `${ROOT}account?tab=profile#details` }); await manager.stop(meta.id)
  meta = await manager.start(request())
  expect(meta.currentUrl).toBe(`${ROOT}account?tab=profile#details`)
})
it('размер окна восстанавливается, а явный viewport имеет приоритет', async () => {
  await ready(); await send({ type: 'resize', viewport: { width: 390, height: 820 } }); await manager.stop(meta.id)
  meta = await manager.start(request()); expect(meta.viewport).toMatchObject({ width: 390, height: 820 })
  await manager.stop(meta.id); meta = await manager.start({ ...request(), viewport: { width: 640, height: 480, deviceScaleFactor: 1 } })
  expect(meta.viewport).toMatchObject({ width: 640, height: 480 })
})
it('одновременные stop/start не удаляют новую incarnation', async () => {
  await ready(); const [, started] = await Promise.all([manager.stop(meta.id), manager.start(request())]); meta = started
  expect(manager.count()).toBe(1); expect(await send({ type: 'status' })).toMatchObject({ incarnation: meta.incarnation, state: 'ready' })
})
it('ошибочная cookie не оставляет Chromium после отказа start', async () => {
  await expect(manager.start({ ...request(), cookies: [{ name: 'bad', value: 'test', url: 'not a URL' }] })).rejects.toThrow()
  expect(manager.count()).toBe(0)
})
it('очистка текущего сайта удаляет HttpOnly и path-cookie, сохраняя доступ к прокси', async () => {
  await ready(); await login(); expect((await state()).cookies.session).toBe(true)
  expect(await send({ type: 'clearSiteData' })).toMatchObject({ ok: true, clearedCookies: 3 })
  expect((await state()).cookies).toEqual({ session: false, persistent: false, path: false, bootstrap: true })
})
it('очистка удаляет IndexedDB, кеш, service worker и sessionStorage', async () => {
  await ready(); await login(); expect((await state()).workers).toBe(1)
  await send({ type: 'clearSiteData' })
  expect(await state()).toMatchObject({ local: null, session: null, databases: [], caches: [], workers: 0 })
})
it('очистка текущего origin сохраняет другой сайт', async () => {
  await ready(); await login(); await send({ type: 'navigate', url: OTHER }); await login()
  await send({ type: 'clearSiteData' })
  expect((await state()).local).toBeNull()
  await send({ type: 'navigate', url: ROOT }); expect((await state()).local).toBe('test-user')
})
it('MCP-очистка всех сайтов с host принимает публичный alias', async () => {
  await ready(); await login(); await send({ type: 'navigate', url: OTHER }); await login()
  expect(await send({ type: 'clearSiteData', scope: 'all', host: 'profile.reader.test' })).toMatchObject({ ok: true })
  expect((await state()).local).toBe('test-user')
  await send({ type: 'navigate', url: ROOT }); expect((await state()).local).toBeNull()
})
it('одноразовый QA-профиль продолжает удаляться', async () => {
  meta = await manager.start({ ...request(), profileMode: 'ephemeral' }); await send({ type: 'navigate', url: ROOT }); await login()
  await manager.stop(meta.id)
  expect(existsSync(profilePath(root, 'test', request().conversationKey))).toBe(false)
})
it('дополнительный файл cookie доступен только владельцу профиля', async () => {
  await ready(); await login(); await manager.stop(meta.id)
  expect((await stat(join(profilePath(root, 'test', request().conversationKey), '.reader-state.json'))).mode & 0o777).toBe(0o600)
})

it('немедленный stop ждёт запуска и не оставляет браузер после отказа start', async () => {
  const starting = manager.start(request())
  const stopping = manager.stop(request().sessionId)
  const [started, stopped] = await Promise.allSettled([starting, stopping])
  expect(started.status).toBe('rejected')
  expect(stopped).toEqual({ status: 'fulfilled', value: true })
  expect(manager.count()).toBe(0)
  expect(contexts.every(context => context.pages().length === 0)).toBe(true)
})
it('повторный stop и закрытие менеджера ждут одного сохранения профиля', async () => {
  await ready(); await login()
  const results = await Promise.all([manager.stop(meta.id), manager.stop(meta.id), manager.close()])
  expect(results.slice(0, 2)).toEqual([true, true])
  expect(manager.count()).toBe(0)
  await expect(manager.start(request())).rejects.toThrow(/closing/)
})
it('сборщик простоя сохраняет вход Reader перед закрытием', async () => {
  await ready(); await login()
  expect(await manager.sweepIdle(1, Date.now() + 100)).toEqual([meta.id])
  meta = await manager.start(request())
  expect(await state()).toMatchObject({ local: 'test-user', cookies: { session: true } })
})
it('all очищает ранее посещённый origin после перезапуска профиля', async () => {
  await ready(); await login(); await send({ type: 'navigate', url: OTHER }); await login()
  await manager.stop(meta.id); meta = await manager.start(request())
  await send({ type: 'clearSiteData', scope: 'all' })
  expect((await state()).local).toBeNull()
  await send({ type: 'navigate', url: ROOT })
  expect(await state()).toMatchObject({ local: null, cookies: { session: false }, databases: [], caches: [] })
})
