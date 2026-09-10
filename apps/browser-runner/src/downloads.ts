import { randomUUID } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import type { BrowserContext, Download, Page } from 'playwright'

import {
  BROWSER_DOWNLOAD_MAX_BYTES,
  BROWSER_DOWNLOAD_TEXT_MAX_BYTES,
  BROWSER_DOWNLOAD_MAX_ACTIVE,
  BROWSER_DOWNLOAD_MAX_ENTRIES,
  browserDownloadId,
  browserDownloadFilename,
  normalizeBrowserDownloadRead,
  type BrowserDownloadInfo,
  type BrowserDownloadReadOptions,
  type BrowserDownloadReadResult,
  type BrowserDownloadMutationResult
} from '@voicechat/shared'
interface Entry {
  download: Download
  info: BrowserDownloadInfo
  path?: string
  failure?: string
  completion: Promise<void>
}

export class BrowserDownloads {
  private readonly entries = new Map<string, Entry>()
  constructor(
    private readonly publicUrl: (url: string) => string,
    private readonly maxBytes = BROWSER_DOWNLOAD_MAX_BYTES,
    private readonly maxEntries = BROWSER_DOWNLOAD_MAX_ENTRIES
  ) {}
  async attachLimits(context: BrowserContext, downloadsPath: string): Promise<void> {
    const browser = context.browser()
    if (!browser) throw new Error('Контроль скачиваний Chromium недоступен')
    const session = await browser.newBrowserCDPSession(),
      canceling = new Set<string>()
    await session.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: downloadsPath,
      eventsEnabled: true
    })
    session.on('Browser.downloadProgress', (event) => {
      if (event.state === 'completed' || event.state === 'canceled') {
        canceling.delete(event.guid)
        return
      }
      if (event.receivedBytes <= this.maxBytes || canceling.has(event.guid)) return
      canceling.add(event.guid)
      void session.send('Browser.cancelDownload', { guid: event.guid }).catch(() => undefined)
    })
  }
  register(page: Page, tabId: string): void {
    page.on('download', (download) => {
      const entry: Entry = {
        download,
        info: {
          id: randomUUID(),
          tabId,
          filename: browserDownloadFilename(download.suggestedFilename()),
          url: download.url().startsWith('blob:')
            ? 'blob:' + this.publicUrl(download.url().slice(5))
            : this.publicUrl(download.url()),
          state: 'downloading',
          startedAt: Date.now()
        },
        completion: Promise.resolve()
      }
      if (entry.info.url.length > 2000) {
        entry.info.url = entry.info.url.slice(0, 2000)
        entry.info.urlTruncated = true
      }
      this.entries.set(entry.info.id, entry)
      const active = [...this.entries.values()].filter((item) => item.info.state === 'downloading')
      if (active.length > BROWSER_DOWNLOAD_MAX_ACTIVE) {
        entry.info.state = 'failed'
        entry.info.error = 'Одновременно доступны восемь скачиваний'
        void download.cancel().catch(() => undefined)
      }
      entry.completion = this.collect(entry)
      this.trim()
    })
  }
  private trim(): void {
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries) break
      if (entry.info.state === 'downloading') continue
      this.entries.delete(id)
      void entry.download.delete().catch(() => undefined)
    }
  }
  private async collect(entry: Entry): Promise<void> {
    try {
      const failure = await entry.download.failure()
      if (!this.entries.has(entry.info.id) || entry.info.state !== 'downloading') {
        await entry.download.delete().catch(() => undefined)
        return
      }
      if (failure) {
        await entry.download.delete().catch(() => undefined)
        entry.failure = failure
        entry.info.state = 'failed'
        entry.info.error = failure === 'canceled' ? 'Скачивание прервано браузером' : failure.slice(0, 500)
        return
      }
      const path = await entry.download.path()
      if (!path) throw new Error('Скачанный файл недоступен')
      const info = await stat(path)
      if (info.size > this.maxBytes) {
        entry.info.state = 'failed'
        entry.info.error = `Файл превышает лимит ${this.maxBytes} байт`
        await entry.download.delete()
        return
      }
      entry.path = path
      entry.info.bytes = info.size
      entry.info.state = 'completed'
    } catch {
      if (this.entries.has(entry.info.id) && entry.info.state === 'downloading') {
        entry.info.state = 'failed'
        entry.info.error = 'Не удалось получить скачанный файл'
      }
    } finally {
      entry.info.completedAt = Date.now()
      this.trim()
    }
  }
  async navigate<T>(page: Page, operation: () => Promise<T>): Promise<T | undefined> {
    let downloadSeen = false
    let signal!: () => void
    const opened = new Promise<void>((resolve) => {
      signal = resolve
    })
    const listener = () => {
      downloadSeen = true
      signal()
    }
    page.on('download', listener)
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Download is starting')) throw error
      if (!downloadSeen) await Promise.race([opened, new Promise((resolve) => setTimeout(resolve, 300))])
      if (!downloadSeen) throw error
      return undefined
    } finally {
      page.off('download', listener)
    }
  }
  list(tabId?: string): BrowserDownloadInfo[] {
    return [...this.entries.values()]
      .filter((item) => tabId === undefined || item.info.tabId === tabId)
      .map((item) => ({ ...item.info }))
      .reverse()
  }
  private require(id: string): Entry {
    browserDownloadId(id)
    const entry = this.entries.get(id)
    if (!entry) throw new Error('stale_download')
    return entry
  }
  async cancel(id: string): Promise<BrowserDownloadMutationResult> {
    const entry = this.require(id)
    if (entry.info.state === 'downloading') {
      await entry.download.cancel()
      await entry.completion
      // Файл мог завершиться до cancel. В таком случае честно оставляем completed.
      if (entry.failure === 'canceled') {
        entry.info.state = 'canceled'
        delete entry.info.error
      }
    }
    return { ok: true, download: { ...entry.info } }
  }
  async remove(id: string): Promise<BrowserDownloadMutationResult> {
    const entry = this.require(id)
    if (entry.info.state === 'downloading') await this.cancel(id)
    await entry.download.delete()
    this.entries.delete(id)
    return { ok: true, deletedDownloadId: id }
  }
  async read(id: string, options: BrowserDownloadReadOptions = {}): Promise<BrowserDownloadReadResult> {
    const { encoding, offset, limit } = normalizeBrowserDownloadRead(options)
    const entry = this.require(id)
    if (entry.info.state !== 'completed' || !entry.path)
      throw new Error(
        entry.info.state === 'downloading' ? 'Скачивание ещё выполняется' : (entry.info.error ?? 'Файл недоступен')
      )
    if (encoding === 'text') {
      if (entry.info.bytes! > BROWSER_DOWNLOAD_TEXT_MAX_BYTES)
        throw new Error('Текстовое чтение доступно до 8 МиБ; используйте base64')
      const bytes = await readFile(entry.path)
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (text.includes('\0')) throw new Error('binary')
      } catch {
        throw new Error('Файл не является текстом UTF-8; используйте base64 или скачайте вложение')
      }
      if (offset > text.length) throw new Error('Смещение за концом файла')
      if (offset > 0 && /[\uDC00-\uDFFF]/.test(text[offset] ?? '') && /[\uD800-\uDBFF]/.test(text[offset - 1]))
        throw new Error('Смещение внутри символа Unicode')
      let end = Math.min(offset + limit, text.length)
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end = end === offset + 1 ? end + 1 : end - 1
      while (JSON.stringify(text.slice(offset, end)).length > 16000) end = offset + Math.floor((end - offset) / 2)
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
      const part = text.slice(offset, end)
      return {
        ok: true,
        download: { ...entry.info },
        encoding,
        text: part,
        offset,
        total: text.length,
        ...(end < text.length ? { nextOffset: end, truncated: true } : {})
      }
    }
    if (offset > entry.info.bytes!) throw new Error('Смещение за концом файла')
    const file = await open(entry.path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(limit, entry.info.bytes! - offset))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      const end = offset + bytesRead
      return {
        ok: true,
        download: { ...entry.info },
        encoding,
        base64: buffer.subarray(0, bytesRead).toString('base64'),
        offset,
        total: entry.info.bytes!,
        ...(end < entry.info.bytes! ? { nextOffset: end, truncated: true } : {})
      }
    } finally {
      await file.close()
    }
  }
}
