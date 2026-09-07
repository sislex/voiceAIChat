// Минимальный ZIP-читатель для импорта проекта: центральный каталог → записи, методы
// «store» (0) и «deflate» (8, через zlib). Служебное (каталоги, скрытые файлы, __MACOSX)
// пропускаем; общую верхнюю папку архива срезаем — так `project/index.html` ложится в корень.

import { inflateRawSync } from 'node:zlib'

export interface ZipReadEntry { path: string; data: Buffer }

export class ZipReadError extends Error {}

export function readZip(buffer: Buffer, limits = { maxEntries: 400, maxEntryBytes: 2 * 1024 * 1024 }): ZipReadEntry[] {
  // End of Central Directory ищем с конца (комментарий архива может быть непустым).
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65_535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new ZipReadError('Это не ZIP-архив')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries: ZipReadEntry[] = []
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new ZipReadError('Повреждён центральный каталог архива')
    const method = buffer.readUInt16LE(offset + 10)
    const compressed = buffer.readUInt32LE(offset + 20)
    const uncompressed = buffer.readUInt32LE(offset + 24)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8')
    offset += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || name.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX')) continue
    if (uncompressed > limits.maxEntryBytes) throw new ZipReadError(`Файл «${name}» больше ${Math.round(limits.maxEntryBytes / 1024)} КБ`)
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipReadError('Повреждён локальный заголовок архива')
    const lNameLen = buffer.readUInt16LE(localOffset + 26)
    const lExtraLen = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + lNameLen + lExtraLen
    const raw = buffer.subarray(start, start + compressed)
    let data: Buffer
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new ZipReadError(`Метод сжатия ${method} не поддерживается (файл «${name}»)`)
    entries.push({ path: name, data })
    if (entries.length > limits.maxEntries) throw new ZipReadError(`В архиве больше ${limits.maxEntries} файлов`)
  }
  return stripCommonRoot(entries)
}

/** `project/index.html`, `project/css/a.css` → без общей папки. */
export function stripCommonRoot(entries: ZipReadEntry[]): ZipReadEntry[] {
  if (entries.length === 0) return entries
  const firstSegments = entries.map((e) => e.path.split('/'))
  if (firstSegments.every((s) => s.length > 1) && new Set(firstSegments.map((s) => s[0])).size === 1) {
    return entries.map((e) => ({ path: e.path.slice(e.path.indexOf('/') + 1), data: e.data }))
  }
  return entries
}
