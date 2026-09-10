import {
  BROWSER_DOWNLOAD_FILE_CHUNK,
  BROWSER_DOWNLOAD_MAX_BYTES,
  BROWSER_DOWNLOAD_MAX_ENTRIES,
  isBrowserDownloadListResult,
  isBrowserDownloadReadResult,
  type BrowserDownloadCommand,
  type BrowserDownloadInfo
} from '@shared/browserDownloads'
import { scenarioCommandError } from '@shared/scenarioStep'

export type DownloadSend = (command: BrowserDownloadCommand) => Promise<unknown>

export async function listAllBrowserDownloads(send: DownloadSend): Promise<BrowserDownloadInfo[]> {
  const items = new Map<string, BrowserDownloadInfo>()
  let offset = 0
  for (let page = 0; page < BROWSER_DOWNLOAD_MAX_ENTRIES; page++) {
    const result = await send({ type: 'downloads', offset })
    if (!isBrowserDownloadListResult(result) || result.offset !== offset)
      throw new Error(scenarioCommandError(result) ?? 'Каталог скачиваний не подтверждён')
    for (const item of result.downloads) items.set(item.id, item)
    if (result.nextOffset === undefined) return [...items.values()]
    if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset)
      throw new Error('Каталог скачиваний не продвигается')
    offset = result.nextOffset
  }
  throw new Error('Каталог скачиваний изменился. Обновите список.')
}

/** Файл собирается только из подтверждённых непрерывных порций; ошибка не сохраняет обрывок. */
export async function browserDownloadBytes(
  send: DownloadSend,
  item: BrowserDownloadInfo,
  current: () => boolean = () => true
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    item.state !== 'completed' ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes! < 0 ||
    item.bytes! > BROWSER_DOWNLOAD_MAX_BYTES
  )
    throw new Error('Файл ещё не готов или превышает лимит64 МиБ')
  const bytes = new Uint8Array(item.bytes!)
  let offset = 0
  do {
    if (!current()) throw new Error('Сохранение отменено')
    const result = await send({
      type: 'readDownload',
      downloadId: item.id,
      encoding: 'base64',
      offset,
      limit: BROWSER_DOWNLOAD_FILE_CHUNK
    })
    if (
      !isBrowserDownloadReadResult(result) ||
      result.encoding !== 'base64' ||
      result.download.id !== item.id ||
      result.offset !== offset ||
      result.total !== bytes.length
    )
      throw new Error(scenarioCommandError(result) ?? 'Содержимое файла не подтверждено')
    let part: string
    try {
      part = atob(result.base64)
    } catch {
      throw new Error('Повреждена порция файла')
    }
    if (offset + part.length > bytes.length || part.length > BROWSER_DOWNLOAD_FILE_CHUNK)
      throw new Error('Неверный размер порции файла')
    bytes.set(
      Uint8Array.from(part, (character) => character.charCodeAt(0)),
      offset
    )
    offset += part.length
    if (offset === bytes.length) {
      if (result.nextOffset !== undefined || result.truncated) throw new Error('Завершение файла не подтверждено')
      if (!current()) throw new Error('Сохранение отменено')
      return bytes
    }
    if (!part.length || result.nextOffset !== offset) throw new Error('В файле пропущена порция')
  } while (offset < bytes.length)
  throw new Error('Файл не завершён')
}
