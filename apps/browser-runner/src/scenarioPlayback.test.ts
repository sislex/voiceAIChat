import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { runScenarioStep, type BrowserCommand, type BrowserSessionMetadata } from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import { startReaderFramesFixture } from './test/readerFrames.js'

let site: Awaited<ReturnType<typeof startReaderFramesFixture>>, manager: BrowserSessionManager, meta: BrowserSessionMetadata, profiles = ''
beforeAll(async () => {
  site = await startReaderFramesFixture(); profiles = await mkdtemp(join(tmpdir(), 'vc-reader-scenario-'))
  manager = new BrowserSessionManager(profiles, new Map([['frames.reader.test', new URL(site.origin).host], ['child.reader.test', new URL(site.childOrigin).host]]))
  meta = await manager.start({ sessionId: 'scenario', userKey: 'test', conversationKey: 'scenario' })
})
afterAll(async () => { await manager?.close(); await site?.close(); if (profiles) await rm(profiles, { recursive: true, force: true }) })
const send = (command: BrowserCommand) => manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant', command })

it.each([
  { label: 'положительное ожидание в конце', text: 'x'.repeat(40_001) + 'Создана задача', expectText: 'Создана задача', ok: true },
  { label: 'фраза на границе порций', text: 'x'.repeat(19_997) + 'Создана задача', expectText: 'Создана задача', ok: true },
  { label: 'запрещённый текст после первой порции', text: 'x'.repeat(40_001) + 'Ошибка', expectAbsentText: 'Ошибка', ok: false },
  { label: 'полное доказательство отсутствия', text: 'x'.repeat(40_001), expectAbsentText: 'Ошибка', ok: true },
  { label: 'ожидание длинного документа в iframe', text: 'x'.repeat(19_997) + 'Создана задача', expectText: 'Создана задача', ok: true, frame: '#outer' }
])('$label в настоящем Chromium', async ({ label, text, expectText, expectAbsentText, ok, frame }) => {
  await send({ type: 'navigate', url: 'http://frames.reader.test/' })
  await send({ type: 'selector', action: { kind: 'wait', loadState: 'load' } })
  await send({ type: 'inspect', ...(frame ? { frame } : {}), action: { kind: 'evaluate', code: `document.body.innerHTML=${JSON.stringify(`<pre style="white-space:pre-wrap">${text}</pre>`)}` } })
  const result = await runScenarioStep({ id: label, title: label, action: { kind: 'wait', loadState: 'load', ...(frame ? { frame } : {}) }, expectText, expectAbsentText }, send, { expectTimeoutMs: 0 })
  expect(result.ok, result.detail).toBe(ok)
  expect(result.unverifiable).toBeUndefined()
})
