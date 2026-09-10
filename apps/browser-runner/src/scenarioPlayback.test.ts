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
  { label: 'положительное ожидание в конце', padding: 40_001, tail: 'Создана задача', expectText: 'Создана задача', ok: true },
  { label: 'фраза на границе порций', padding: 19_997, tail: 'Создана задача', expectText: 'Создана задача', ok: true },
  { label: 'запрещённый текст после первой порции', padding: 40_001, tail: 'Ошибка', expectAbsentText: 'Ошибка', ok: false },
  { label: 'полное доказательство отсутствия', padding: 40_001, tail: '', expectAbsentText: 'Ошибка', ok: true },
  { label: 'ожидание длинного документа в iframe', padding: 19_997, tail: 'Создана задача', expectText: 'Создана задача', ok: true, frame: '#outer' }
])('$label в настоящем Chromium', async ({ label, padding, tail, expectText, expectAbsentText, ok, frame }) => {
  await send({ type: 'navigate', url: 'http://frames.reader.test/' })
  await send({ type: 'selector', action: { kind: 'wait', loadState: 'load' } })
  // Размер документа проверяется отдельно от лимита кода evaluate; отказ подготовки не должен давать ложный успех.
  const prepared = await send({ type: 'inspect', ...(frame ? { frame } : {}), action: { kind: 'evaluate', code: `document.body.innerHTML='<pre style="white-space:pre-wrap"></pre>'; document.querySelector('pre').textContent='x'.repeat(${padding})+${JSON.stringify(tail)}; true` } })
  expect(prepared).toMatchObject({ ok: true, value: true })
  const result = await runScenarioStep({ id: label, title: label, action: { kind: 'wait', loadState: 'load', ...(frame ? { frame } : {}) }, expectText, expectAbsentText }, send, { expectTimeoutMs: 0 })
  expect(result.ok, result.detail).toBe(ok)
  expect(result.unverifiable).toBeUndefined()
})
