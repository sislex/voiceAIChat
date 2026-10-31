import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { MAX_STORAGE_BATCH_OPERATIONS, STORAGE_COMPRESSION_MIN_BYTES, isStorageCompressible, isStorageSmallText,
  storageContentEncoding, type StorageBatchOperation, type StorageBatchResult, type StorageContentEncoding } from '@voicechat/shared/fileStorage'
import type { FileStorageService } from '../../../../packages/file-storage/src/service.js'
import { StorageServiceError } from '../../../../packages/file-storage/src/errors.js'
import { brotliCompress, gzip } from 'node:zlib'
import { promisify } from 'node:util'

const compress = {
  br: promisify(brotliCompress),
  gzip: promisify(gzip),
} satisfies Record<StorageContentEncoding, (bytes: Uint8Array) => Promise<Buffer>>

export function parseStorageBatch(body: Buffer) {
  const invalid = (): never => { throw new StorageServiceError('invalid_path') }
  let records: unknown[]
  try { records = body.toString('utf8').trim().split('\n').map(line => JSON.parse(line)) } catch { return invalid() }
  const first = records.shift() as { operations?: StorageBatchOperation[] } | null
  const operations = first?.operations
  if (!Array.isArray(operations) || !operations.length || operations.length > MAX_STORAGE_BATCH_OPERATIONS) return invalid()
  const payloads = new Map<string, { bytes: Buffer; mimeType: string }>()
  for (const record of records) {
    const p = record as { bodyRef?: unknown; base64?: unknown; mimeType?: unknown } | null
    if (!p || typeof p.bodyRef !== 'string' || !p.bodyRef || payloads.has(p.bodyRef) ||
      typeof p.base64 !== 'string' || typeof p.mimeType !== 'string' || !p.mimeType.trim() ||
      p.mimeType.length > 255 || /[\r\n]/.test(p.mimeType)) return invalid()
    const bytes = Buffer.from(p.base64, 'base64')
    if (bytes.toString('base64') !== p.base64) return invalid()
    payloads.set(p.bodyRef, { bytes, mimeType: p.mimeType })
  }
  return { operations, payloads }
}

export async function storageBatchResponse(service: FileStorageService, userId: string, spaceId: string, body: Buffer, acceptEncoding?: string) {
  const { operations, payloads } = parseStorageBatch(body)
  await service.checkBatch(userId, spaceId, operations, payloads)
  const boundary = 'storage-' + randomUUID()
  async function* parts() {
    for (const [index, op] of operations.entries()) {
      let result: StorageBatchResult, bytes: Uint8Array | undefined, contentEncoding: StorageContentEncoding | undefined,
        bodyMimeType: string | undefined
      try {
        if (!op || typeof op.path !== 'string' ||
          (op.ifMatch !== undefined && (!Number.isSafeInteger(op.ifMatch) || op.ifMatch < 1)) ||
          (op.createOnly !== undefined && typeof op.createOnly !== 'boolean')) throw new StorageServiceError('invalid_path')
        switch (op.op) {
          case 'read': {
            const file = await service.readFile(userId, spaceId, op.path)
            result = { status: 200, entry: file.entry }
            contentEncoding = file.entry.size > STORAGE_COMPRESSION_MIN_BYTES && isStorageCompressible(file.entry.mimeType)
              ? storageContentEncoding(acceptEncoding) : undefined
            bytes = contentEncoding ? await compress[contentEncoding](file.bytes) : file.bytes
            if (isStorageSmallText(file.entry)) {
              result.content = { encoding: 'base64', data: Buffer.from(bytes).toString('base64'), ...(contentEncoding ? {contentEncoding} : {}) }
              bytes = undefined
            } else { result.bodyRef = `read-${index}`; bodyMimeType = file.entry.mimeType }
            break
          }
          case 'write': {
            const payload = payloads.get(op.bodyRef ?? '')
            if (!payload) throw new StorageServiceError('invalid_path')
            result = { status: 200, entry: await service.writeFile(userId, spaceId, op.path, payload.bytes, { ...op, mimeType: payload.mimeType }) }
            break
          }
          case 'copy': case 'move':
            if (typeof op.to !== 'string') throw new StorageServiceError('invalid_path')
            result = { status: 200, entry: await service[op.op](userId, spaceId, op.path, op.to, op) }
            break
          case 'delete':
            await service.deleteFile(userId, spaceId, op.path, op)
            result = { status: 204 }
            break
          default: throw new StorageServiceError('invalid_path')
        }
      } catch (error) {
        const e = error instanceof StorageServiceError ? error : new StorageServiceError('node_unavailable')
        result = { status: e.statusCode, error: { error: e.code, message: e.message } }
      }
      yield `--${boundary}\r\nContent-Type: application/json\r\nContent-ID: result-${index}\r\n\r\n${JSON.stringify(result)}\r\n`
      if (bytes) {
        yield `--${boundary}\r\nContent-Type: ${bodyMimeType}\r\nContent-ID: read-${index}\r\nContent-Length: ${bytes.byteLength}\r\n${contentEncoding ? `Content-Encoding: ${contentEncoding}\r\n` : ''}\r\n`
        yield Buffer.from(bytes)
        yield '\r\n'
      }
    }
    yield `--${boundary}--\r\n`
  }
  return { contentType: `multipart/mixed; boundary=${boundary}`, stream: Readable.from(parts()) }
}
