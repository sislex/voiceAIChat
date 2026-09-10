import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { chromium } from 'playwright'
import type {
  BrowserCommand,
  BrowserDownloadInfo,
  BrowserDownloadListResult,
  BrowserDownloadReadResult,
  BrowserSessionMetadata
} from '@voicechat/shared'
import { BrowserSessionManager } from './sessionManager.js'
import { BrowserDownloads } from './downloads.js'
import { profilePath } from './security.js'
import { startReaderDownloadsFixture } from './test/readerDownloads.js'
let root = '',
  site: Awaited<ReturnType<typeof startReaderDownloadsFixture>>,
  manager: BrowserSessionManager,
  meta: BrowserSessionMetadata
const send = (command: BrowserCommand) =>
  manager.command(meta.id, { requestId: randomUUID(), incarnation: meta.incarnation, actor: 'assistant', command })
const list = async () => ((await send({ type: 'downloads' })) as BrowserDownloadListResult).downloads
const read = async (id: string, options = {}) =>
  (await send({ type: 'readDownload', downloadId: id, ...options })) as BrowserDownloadReadResult
async function download(selector: string, completed = true): Promise<BrowserDownloadInfo> {
  const before = new Set((await list()).map((item) => item.id))
  await send({ type: 'selector', action: { kind: 'click', selector } })
  let item: BrowserDownloadInfo | undefined
  await expect
    .poll(
      async () => {
        item = (await list()).find((item) => !before.has(item.id))
        return item?.state
      },
      { timeout: 5000 }
    )
    .toBe(completed ? 'completed' : 'downloading')
  return item!
}
beforeAll(async () => {
  site = await startReaderDownloadsFixture()
  root = await mkdtemp(join(tmpdir(), 'vc-reader-download-tests-'))
})
beforeEach(async () => {
  manager = new BrowserSessionManager(root, new Map([['downloads.reader.test', new URL(site.origin).host]]))
  meta = await manager.start({
    sessionId: randomUUID(),
    userKey: 'test',
    conversationKey: randomUUID(),
    profileMode: 'persistent'
  })
  await send({ type: 'navigate', url: 'http://downloads.reader.test/' })
})
afterEach(async () => {
  await manager.close()
})
afterAll(async () => {
  await site.close()
  await rm(root, { recursive: true, force: true })
})

it('HTTP-вложение получает имя, размер и публичный URL, не закрывая страницу', async () => {
  const item = await download('#file')
  expect(item).toMatchObject({
    filename: 'Отчёт.txt',
    url: 'http://downloads.reader.test/file',
    tabId: meta.activeTabId,
    state: 'completed'
  })
  expect(item.bytes).toBeGreaterThan(50000)
  expect(((await send({ type: 'status' })) as BrowserSessionMetadata).currentUrl).toBe('http://downloads.reader.test/')
})
it('Blob-экспорт сохраняет Unicode и подменённый origin', async () => {
  const item = await download('#blob')
  expect(item.filename).toBe('export.txt')
  expect(item.url).toMatch(/^blob:http:\/\/downloads.reader.test\//)
  expect(await read(item.id)).toMatchObject({ encoding: 'text', text: 'Данные из проекта 😀' })
})
it('текст дочитывается до конца без потери строк и символов', async () => {
  const item = await download('#file')
  let offset = 0,
    text = ''
  for (let part = 0; part < 5; part++) {
    const result = await read(item.id, { offset })
    if (result.encoding !== 'text') throw new Error('text expected')
    text += result.text
    if (result.nextOffset === undefined) break
    offset = result.nextOffset
  }
  expect(text).toBe('Начало 😀\n' + 'Строка отчёта\n'.repeat(2200) + 'Конец')
})
it('граница порции не разрывает surrogate pair', async () => {
  const item = await download('#blob'),
    first = await read(item.id, { limit: 19 })
  expect(first).toMatchObject({ text: 'Данные из проекта ', nextOffset: 18 })
  expect(await read(item.id, { offset: 18, limit: 1 })).toMatchObject({ text: '😀' })
  await expect(read(item.id, { offset: 19 })).rejects.toThrow('Unicode')
})
it('бинарные байты читаются частями без перекодирования', async () => {
  const item = await download('#binary'),
    first = await read(item.id, { encoding: 'base64', limit: 2 }),
    second = await read(item.id, { encoding: 'base64', offset: 2 })
  if (first.encoding !== 'base64' || second.encoding !== 'base64') throw new Error('base64 expected')
  expect(Buffer.concat([Buffer.from(first.base64, 'base64'), Buffer.from(second.base64, 'base64')])).toEqual(
    Buffer.from([0, 255, 1, 2, 3, 128])
  )
  await expect(read(item.id)).rejects.toThrow('не является текстом')
})
it('неготовый файл не выдаётся за пустой, отмена останавливает поток', async () => {
  const item = await download('#slow', false)
  await expect(read(item.id)).rejects.toThrow('ещё выполняется')
  expect(await send({ type: 'cancelDownload', downloadId: item.id })).toMatchObject({
    ok: true,
    download: { state: 'canceled' }
  })
  await expect(read(item.id)).rejects.toThrow('Файл недоступен')
})
it('удаление очищает файл и отвергает старый id', async () => {
  const item = await download('#binary')
  expect(await send({ type: 'deleteDownload', downloadId: item.id })).toEqual({ ok: true, deletedDownloadId: item.id })
  expect(await list()).toEqual([])
  await expect(read(item.id)).rejects.toThrow('stale_download')
})
it('прямой адрес вложения возвращает каталог скачивания без ошибки навигации', async () => {
  const result = (await send({ type: 'navigate', url: 'http://downloads.reader.test/file' })) as BrowserSessionMetadata
  expect(result.downloadCount).toBe(1)
  expect(result.currentUrl).toBe('http://downloads.reader.test/')
})
it('новая вкладка с адресом вложения остаётся управляемой', async () => {
  const result = (await send({ type: 'newTab', url: 'http://downloads.reader.test/file' })) as BrowserSessionMetadata
  expect(result.downloads?.[0].tabId).toBe(result.activeTabId)
  expect(result.activeTabId).not.toBe(meta.activeTabId)
})
it('каталог вкладки доступен после её закрытия', async () => {
  const item = await download('#binary')
  await send({ type: 'newTab' })
  await send({ type: 'closeTab', tabId: item.tabId })
  expect(await send({ type: 'downloads', tabId: item.tabId })).toMatchObject({ downloads: [{ id: item.id }] })
  await expect(send({ type: 'downloads', tabId: 'missing' })).rejects.toThrow('stale_tab')
})
it('ошибочные диапазоны и чужой id не меняют скачанные данные', async () => {
  const item = await download('#binary')
  for (const options of [
    { offset: -1 },
    { limit: 0 },
    { encoding: 'other' },
    { limit: 12001 },
    { offset: 7, encoding: 'base64' }
  ])
    await expect(read(item.id, options)).rejects.toThrow()
  const other = await manager.start({ sessionId: randomUUID(), userKey: 'test', conversationKey: randomUUID() })
  await expect(
    manager.command(other.id, {
      requestId: randomUUID(),
      incarnation: other.incarnation,
      actor: 'assistant',
      command: { type: 'readDownload', downloadId: item.id }
    })
  ).rejects.toThrow('stale_download')
  await expect(send({ type: 'readDownload', downloadId: item.id, frame: '#frame' })).rejects.toThrow('frame')
  expect((await list())[0].id).toBe(item.id)
})
it('stop удаляет каталог файлов даже у постоянного профиля', async () => {
  await download('#binary')
  const path = profilePath(root, 'test', meta.conversationId)
  expect((await readdir(path)).some((name) => name.startsWith('reader-downloads-'))).toBe(true)
  await manager.stop(meta.id)
  expect((await readdir(path)).some((name) => name.startsWith('reader-downloads-'))).toBe(false)
})
it('живой лимит прерывает бесконечный поток до его завершения', async () => {
  const path = await mkdtemp(join(root, 'limit-')),
    downloadsPath = join(path, 'downloads')
  const context = await chromium.launchPersistentContext(path, { acceptDownloads: true, downloadsPath })
  try {
    const downloads = new BrowserDownloads((url) => url, 8192)
    await downloads.attachLimits(context, downloadsPath)
    const page = context.pages()[0]
    downloads.register(page, 't')
    await page.goto(site.origin)
    await page.locator('#slow').click()
    await expect.poll(() => downloads.list()[0]?.state, { timeout: 4000 }).toBe('failed')
    expect(downloads.list()[0].error).toBe('Скачивание прервано браузером')
  } finally {
    await context.close()
  }
})

it('отмена готового файла сохраняет completed и его байты', async () => {
  const item = await download('#binary')
  expect(await send({ type: 'cancelDownload', downloadId: item.id })).toMatchObject({
    download: { state: 'completed', bytes: 6 }
  })
  expect(await read(item.id, { encoding: 'base64' })).toMatchObject({ base64: 'AP8BAgOA' })
})

it('ограниченный каталог удаляет старые файлы без раскрытия системного пути', async () => {
  const path = await mkdtemp(join(root, 'retention-')),
    context = await chromium.launchPersistentContext(path, { acceptDownloads: true })
  try {
    const downloads = new BrowserDownloads((url) => url, 64 * 1024 * 1024, 2),
      page = context.pages()[0]
    downloads.register(page, 't')
    await page.goto(site.origin)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      await page.locator('#binary').click()
      await expect.poll(() => downloads.list().find((item) => !ids.includes(item.id))?.state).toBe('completed')
      ids.push(downloads.list()[0].id)
    }
    expect(downloads.list()).toHaveLength(2)
    await expect(downloads.read(ids[0])).rejects.toThrow('stale_download')
    expect(JSON.stringify(downloads.list())).not.toContain(root)
  } finally {
    await context.close()
  }
})

it('итоговый размер отсекает слишком быстрый файл даже без промежуточного progress', async () => {
  const path = await mkdtemp(join(root, 'final-limit-')),
    context = await chromium.launchPersistentContext(path, { acceptDownloads: true })
  try {
    const downloads = new BrowserDownloads((url) => url, 4),
      page = context.pages()[0]
    downloads.register(page, 't')
    await page.goto(site.origin)
    await page.locator('#binary').click()
    await expect.poll(() => downloads.list()[0]?.state).toBe('failed')
    expect(downloads.list()[0].error).toContain('превышает лимит 4')
    await expect(downloads.read(downloads.list()[0].id)).rejects.toThrow('превышает')
  } finally {
    await context.close()
  }
})

it('девятое незавершённое скачивание явно отклоняется', async () => {
  // Один HTTP/1 origin ограничен шестью соединениями Chromium: разные порты
  // позволяют проверить лимит Reader, не упираясь раньше в сетевую очередь.
  const sites: Awaited<ReturnType<typeof startReaderDownloadsFixture>>[] = []
  const path = await mkdtemp(join(root, 'active-limit-')),
    context = await chromium.launchPersistentContext(path, { acceptDownloads: true })
  try {
    const downloads = new BrowserDownloads((url) => url),
      page = context.pages()[0]
    downloads.register(page, 't')
    for (let i = 0; i < 9; i++) {
      const site = await startReaderDownloadsFixture()
      sites.push(site)
      await page.goto(site.origin)
      await page.locator('#slow').click()
    }
    await expect.poll(() => downloads.list().filter((item) => item.state === 'failed').length).toBe(1)
    expect(downloads.list().filter((item) => item.state === 'downloading')).toHaveLength(8)
    expect(downloads.list().find((item) => item.state === 'failed')?.error).toContain('восемь')
  } finally {
    await context.close()
    await Promise.all(sites.map((site) => site.close()))
  }
})

it('старт после аварии удаляет только старые каталоги скачиваний своего профиля', async () => {
  const conversationKey = meta.conversationId, path = profilePath(root, 'test', conversationKey)
  await manager.stop(meta.id)
  const staleName = 'reader-downloads-' + randomUUID()
  await mkdir(join(path, staleName)); await writeFile(join(path, staleName, 'partial'), 'orphan')
  await mkdir(join(path, 'reader-downloads-user-folder'))
  await manager.start({ sessionId: meta.id, userKey: 'test', conversationKey, profileMode: 'persistent' })
  expect(await readdir(path)).not.toContain(staleName)
  expect(await readdir(path)).toContain('reader-downloads-user-folder')
})
