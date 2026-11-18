import type { FastifyInstance, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { Readable } from 'node:stream'
import { StorageServiceError } from '../../../packages/file-storage/src/errors.js'
import { CHAT_UPLOAD_METADATA_HEADERS, MAX_CHAT_UPLOAD_BYTES, type ChatUploadJsonRequest, type ChatUploadMetadata } from '@voicechat/shared/fileStorage'

function bad(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode })
}
/** One refusal for every way a chat attachment can exceed its limit, so the client can name the reason. */
export function uploadTooLarge(limit = MAX_CHAT_UPLOAD_BYTES): never {
  throw new StorageServiceError('file_too_large', `Файл больше допустимого размера вложения: ${Math.floor(limit / 1024 / 1024)} МБ`, { limitBytes: limit })
}
function multipartError(error: unknown): never {
  if (error instanceof Error && 'statusCode' in error) throw error
  bad('invalid multipart body')
}
function metadata(req: FastifyRequest): ChatUploadMetadata {
  const query = req.query as Record<string, unknown>
  return Object.fromEntries(Object.entries(CHAT_UPLOAD_METADATA_HEADERS).map(([key, header]) => {
    const value = query?.[key] ?? req.headers[header]
    if (value !== undefined && typeof value !== 'string') bad('invalid ' + key)
    return [key, value]
  }))
}

/** Scoped to uploads: leave all other JSON/text routes untouched. */
export async function registerUploadParsers(app: FastifyInstance) {
  app.removeAllContentTypeParsers()
  await app.register(multipart, { limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_CHAT_UPLOAD_BYTES + 1 } })
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload))
}

export async function readUpload(req: FastifyRequest): Promise<{
  metadata: ChatUploadMetadata
  bytes: Uint8Array | AsyncIterable<Uint8Array>
}> {
  let info = metadata(req)
  let source: AsyncIterable<Uint8Array> | Uint8Array
  const contentType = req.headers['content-type']?.split(';')[0].trim().toLowerCase()
  if (req.isMultipart()) {
    const parts = req.parts()
    const first = await parts.next().catch(multipartError)
    if (first.done || first.value.type !== 'file') bad('single file required')
    const file = first.value
    info = { ...info, name: info.name ?? file.filename, mimeType: info.mimeType ?? file.mimetype }
    source = (async function* () {
      try {
        yield* file.file
        if (file.file.truncated) uploadTooLarge()
        // Finish parsing before the storage coordinator commits metadata.
        if (!(await parts.next()).done) bad('single file required')
      } catch (error) { multipartError(error) }
      finally { await parts.return?.() }
    })()
  } else if (contentType === 'application/json' && info.name === undefined) {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req.body as Readable) {
      size += chunk.length
      if (size > 64 * 1024 * 1024) uploadTooLarge()
      chunks.push(Buffer.from(chunk))
    }
    let body: ChatUploadJsonRequest
    try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { bad('invalid JSON') }
    if (!body || typeof body !== 'object') bad('invalid data')
    const data = body.dataBase64
    if (typeof data !== 'string' || !data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) bad('invalid data')
    info = { ...body, name: body.name ?? 'file' }
    source = Buffer.from(data, 'base64')
    if (source.byteLength > MAX_CHAT_UPLOAD_BYTES) uploadTooLarge()
  } else {
    info.mimeType ??= contentType
    // A declared length over the limit is refused before a byte reaches the storage.
    if (Number(req.headers['content-length']) > MAX_CHAT_UPLOAD_BYTES) uploadTooLarge()
    source = req.body as Readable ?? Readable.from([])
  }
  for (const key of Object.keys(CHAT_UPLOAD_METADATA_HEADERS) as Array<keyof ChatUploadMetadata>) {
    if (info[key] !== undefined && typeof info[key] !== 'string') bad('invalid ' + key)
  }
  if (!info.name?.trim()) bad('name required')
  return { metadata: info, bytes: source instanceof Uint8Array ? source : limitUpload(source) }
}

export async function* limitUpload(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, limit = MAX_CHAT_UPLOAD_BYTES) {
  let size = 0
  for await (const chunk of source) {
    size += chunk.byteLength
    if (size > limit) uploadTooLarge(limit)
    yield chunk
  }
}

export async function bufferUpload(source: Uint8Array | AsyncIterable<Uint8Array>): Promise<Buffer> {
  if (source instanceof Uint8Array) return Buffer.from(source)
  const chunks: Buffer[] = []
  for await (const chunk of source) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
