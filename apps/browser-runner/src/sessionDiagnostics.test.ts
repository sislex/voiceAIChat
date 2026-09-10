import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, afterAll, afterEach, it, expect } from 'vitest'
import {
  planModelAction,
  previewResultJson,
  type BrowserCommand,
  type BrowserInspectAction,
  type BrowserInspectResult,
  type BrowserSessionMetadata
} from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import { startReaderDiagnosticsFixture } from './test/readerDiagnostics.js'
let root = '',
  site: Awaited<ReturnType<typeof startReaderDiagnosticsFixture>>,
  manager: BrowserSessionManager,
  meta: BrowserSessionMetadata
const send = (command: BrowserCommand) =>
  manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant', command })
const inspect = async (action: BrowserInspectAction) =>
  (await send({ type: 'inspect', action })) as BrowserInspectResult
const click = (id: string) => send({ type: 'selector', action: { kind: 'click', selector: '#' + id } })
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vc-reader-diagnostics-'))
  site = await startReaderDiagnosticsFixture()
})
beforeEach(async () => {
  manager = new BrowserSessionManager(root, new Map([['diag.reader.test', new URL(site.origin).host]]))
  meta = await manager.start({ sessionId: randomUUID(), userKey: 'test', conversationKey: randomUUID() })
  await send({ type: 'navigate', url: 'http://diag.reader.test/' })
})
afterEach(async () => {
  await manager?.close()
})
afterAll(async () => {
  await site?.close()
  await rm(root, { recursive: true, force: true })
})
it('показывает pending, завершение и длительность того же запроса по курсору', async () => {
  await click('network')
  const pending = await inspect({ kind: 'network', state: 'pending', filter: '/slow' })
  expect(pending.network).toHaveLength(1)
  expect(pending.network![0]).toMatchObject({
    resourceType: 'fetch',
    tabId: meta.activeTabId,
    pageUrl: 'http://diag.reader.test/'
  })
  await expect
    .poll(async () => (await inspect({ kind: 'network', since: pending.cursor, filter: '/slow' })).network?.[0]?.state)
    .toBe('completed')
  const finished = (await inspect({ kind: 'network', filter: '/slow' })).network![0]
  expect(finished.id).toBe(pending.network![0].id)
  expect(finished.durationMs).toBeGreaterThanOrEqual(200)
})
it('сбой без HTTP и HTTP503 входят в failedOnly, успешные исключены', async () => {
  await click('network')
  await expect.poll(async () => (await inspect({ kind: 'network', state: 'failed' })).network?.length).toBe(1)
  const rows = (await inspect({ kind: 'network', failedOnly: true })).network!
  expect(rows).toHaveLength(2)
  expect(rows.find((row) => row.url.endsWith('/broken'))).toMatchObject({
    status: 0,
    ok: false,
    state: 'failed',
    error: expect.stringContaining('ERR_')
  })
  expect(rows.find((row) => row.url.endsWith('/bad'))).toMatchObject({ status: 503, ok: false })
})
it('фильтр использует публичный URL и контекст документа', async () => {
  const row = (await inspect({ kind: 'network', filter: 'diag.reader.test' })).network![0]
  expect(row).toMatchObject({
    url: 'http://diag.reader.test/',
    frameUrl: 'http://diag.reader.test/',
    pageUrl: 'http://diag.reader.test/'
  })
})
it('warn нормализован, mapper модели ищет буквальную подстроку', async () => {
  await click('logs')
  expect((await inspect({ kind: 'console', level: 'warn' })).console![0]).toMatchObject({
    level: 'warn',
    sourceType: 'warning',
    text: 'Warning marker'
  })
  const plan = planModelAction({ kind: 'console', pattern: 'literal [x]' })
  if (plan.kind !== 'command') throw new Error('Expected command')
  const command = plan.command
  expect(((await send(command)) as BrowserInspectResult).console).toHaveLength(1)
})
it('вложенные console args и массивы читаются без вызова getter', async () => {
  await click('logs')
  await expect
    .poll(async () =>
      JSON.stringify((await inspect({ kind: 'console', pattern: 'Payload', regex: false })).console![0].args)
    )
    .toContain('Вложенные данные')
  expect((await inspect({ kind: 'console', pattern: 'Payload', regex: false })).console![0].args![1]).toEqual({
    nested: { detail: 'Вложенные данные' },
    items: [1, 2, 3]
  })
  await inspect({ kind: 'evaluate', code: 'console.log({get secret(){throw new Error("Getter was called")}})' })
  await expect.poll(async () => JSON.stringify((await inspect({ kind: 'console' })).console)).toContain('[Getter]')
  expect((await inspect({ kind: 'console', level: 'error' })).console).toHaveLength(0)
})
it('исключение содержит стек и публичный адрес источника', async () => {
  await click('error')
  await expect.poll(async () => (await inspect({ kind: 'console', level: 'error' })).console?.length).toBe(1)
  expect((await inspect({ kind: 'console', level: 'error' })).console![0]).toMatchObject({
    sourceType: 'pageerror',
    stack: expect.stringContaining('diag.reader.test')
  })
})
it('активная вкладка изолирована, allTabs и закрытая вкладка доступны явно', async () => {
  await click('logs')
  const first = meta.activeTabId!
  await send({ type: 'newTab', url: 'http://diag.reader.test/second' })
  expect((await inspect({ kind: 'console' })).console).toHaveLength(0)
  expect((await inspect({ kind: 'console', allTabs: true })).console).toHaveLength(3)
  await send({ type: 'closeTab', tabId: first })
  expect((await inspect({ kind: 'console', tabId: first })).console).toHaveLength(3)
  await expect(inspect({ kind: 'console', tabId: 'missing' })).rejects.toThrow('stale_tab')
})
it('очищает только возвращённый фильтр и не трогает другую вкладку', async () => {
  await click('logs')
  await expect
    .poll(async () => (await inspect({ kind: 'console' })).console?.some((row) => row.argsPending))
    .toBe(false)
  const first = meta.activeTabId!
  await send({ type: 'newTab', url: 'http://diag.reader.test/second' })
  await click('logs')
  expect(await inspect({ kind: 'console', tabId: first, level: 'warn', clear: true })).toMatchObject({ cleared: 1 })
  expect((await inspect({ kind: 'console', tabId: first })).console).toHaveLength(2)
  expect((await inspect({ kind: 'console' })).console).toHaveLength(3)
})
it('невалидный курсор не очищает буфер', async () => {
  await click('logs')
  expect(await inspect({ kind: 'console', clear: true, since: 5, before: 2 })).toMatchObject({ ok: false })
  expect((await inspect({ kind: 'console' })).console).toHaveLength(3)
})
it('большой журнал дочитывается без пропусков и помещается в MCP', async () => {
  await click('spam')
  await expect.poll(async () => (await inspect({ kind: 'console', level: 'error', limit: 200 })).total).toBe(100)
  await expect
    .poll(async () => (await inspect({ kind: 'console', level: 'error', limit: 1 })).console![0].argsPending)
    .toBeUndefined()
  const seen = new Set<string>()
  let before: number | undefined
  do {
    const result = await inspect({ kind: 'console', level: 'error', limit: 100, before })
    expect(result.ok).toBe(true)
    expect(previewResultJson(result)).not.toBeNull()
    for (const entry of result.console!) {
      expect(seen.has(entry.id!)).toBe(false)
      seen.add(entry.id!)
    }
    before = result.nextBefore
  } while (before !== undefined)
  expect(seen.size).toBe(100)
})
it('clear limit сохраняет непрочитанный хвост', async () => {
  await click('logs')
  expect(await inspect({ kind: 'console', limit: 1, clear: true })).toMatchObject({
    returned: 1,
    cleared: 1,
    truncated: true
  })
  expect((await inspect({ kind: 'console' })).console).toHaveLength(2)
})
it('каталог скачиваний не создаёт ложную ошибку ERR_ABORTED в сети', async () => {
  await send({ type: 'navigate', url: 'http://diag.reader.test/download' })
  expect((await inspect({ kind: 'network', filter: '/download' })).network![0]).toMatchObject({
    download: true,
    ok: true,
    state: 'completed'
  })
  expect((await inspect({ kind: 'network', failedOnly: true })).network).toHaveLength(0)
})
it('консоль не блокируется сериализацией при JavaScript-диалоге', async () => {
  await expect(
    inspect({ kind: 'evaluate', code: 'console.log("before",{nested:{value:1}});alert("stop")' })
  ).rejects.toThrow('Открыт диалог')
  const start = Date.now()
  expect((await inspect({ kind: 'console' })).console![0].text).toContain('before')
  expect(Date.now() - start).toBeLessThan(300)
})
it('вытеснение старых записей явно отражено в ответе', async () => {
  await click('spam')
  await click('spam')
  await click('spam')
  const result = await inspect({ kind: 'console', limit: 200 })
  expect(result.total).toBe(200)
  expect(result.dropped).toBe(100)
})

it('сокращение вложенного console значения помечено явно', async () => {
  await inspect({ kind: 'evaluate', code: 'console.log("Bounded",{text:"x".repeat(3000),nested:{a:{b:{c:{d:1}}}}})' })
  await expect
    .poll(async () => (await inspect({ kind: 'console', pattern: 'Bounded', regex: false })).console![0].argsPending)
    .toBeUndefined()
  const row = (await inspect({ kind: 'console', pattern: 'Bounded', regex: false })).console![0]
  expect(row.argsTruncated).toBe(true)
  expect(JSON.stringify(row.args)).toContain('Вложенный объект')
})
