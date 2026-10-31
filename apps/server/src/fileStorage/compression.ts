import { promisify } from 'node:util'
import { brotliCompress, gzip, constants, createBrotliDecompress, createGunzip } from 'node:zlib'
import { pipeline, Transform } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { isStorageCompressible, STORAGE_COMPRESSION_MIN_BYTES, MAX_STORAGE_FILE_BYTES, type StorageContentEncoding } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from '../../../../packages/file-storage/src/errors.js'

const br = promisify(brotliCompress)
const gz = promisify(gzip)
export function storageEncoding(header = ''): StorageContentEncoding | undefined {
  const weights = new Map(header.toLowerCase().split(',').map(part => {
    const [name, ...params] = part.trim().split(';')
    const q = params.find(p => p.trim().startsWith('q='))
    const weight = q ? Number(q.trim().slice(2)) : 1
    return [name.trim(), Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0]
  }))
  const quality = (name: string) => weights.get(name) ?? weights.get('*') ?? 0
  const encoding = quality('br') >= quality('gzip') ? 'br' : 'gzip'
  return quality(encoding) > 0 && quality(encoding) >= (weights.get('identity') ?? 0) ? encoding : undefined
}
export async function compressStorage(body: Buffer, mime: string, encoding?: StorageContentEncoding) {
  if (!encoding || body.length <= STORAGE_COMPRESSION_MIN_BYTES || !isStorageCompressible(mime)) return { body }
  return { body: encoding === 'br' ? await br(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : await gz(body), encoding }
}

/** Storage owns its response compression, including multipart parts. */
export function registerStorageCompression(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    const vary = String(reply.getHeader('vary') ?? '')
    if (!vary.split(',').some(v => ['*', 'accept-encoding'].includes(v.trim().toLowerCase())))
      reply.header('vary', vary ? vary + ', Accept-Encoding' : 'Accept-Encoding')
    if (req.method === 'HEAD' || req.headers.range || reply.statusCode !== 200 ||
        reply.hasHeader('content-range') || reply.hasHeader('content-encoding') ||
        !(typeof payload === 'string' || Buffer.isBuffer(payload))) return payload
    const result = await compressStorage(Buffer.from(payload), String(reply.getHeader('content-type') ?? ''), storageEncoding(req.headers['accept-encoding']))
    if (!result.encoding) return payload
    reply.header('content-encoding', result.encoding).header('content-length', result.body.length)
    reply.removeHeader('accept-ranges')
    const etag = reply.getHeader('etag')
    if (typeof etag === 'string' && !etag.startsWith('W/')) reply.header('etag', 'W/' + etag)
    return result.body
  })
}

/** Decode incrementally before the raw parser, bounding the decoded body. */
export function registerStorageDecompression(app: FastifyInstance, limit = MAX_STORAGE_FILE_BYTES): void {
  app.addHook('preParsing', async (req, _reply, payload) => {
    const encoding = req.headers['content-encoding']?.trim().toLowerCase()
    if (!encoding || encoding === 'identity') return payload
    if (encoding !== 'gzip' && encoding !== 'br') throw new StorageServiceError('unsupported_media_type')
    const decoder = encoding === 'br' ? createBrotliDecompress() : createGunzip()
    let size = 0
    const output = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length
        callback(size > limit ? new StorageServiceError('file_too_large') : null, size > limit ? undefined : chunk)
      },
    }) as Transform & { receivedEncodedLength: number }
    decoder.on('error', () => {
      if (!output.destroyed) output.destroy(new StorageServiceError('invalid_path'))
    })
    output.receivedEncodedLength = 0
    payload.on('data', chunk => { output.receivedEncodedLength += chunk.length })
    pipeline(payload, decoder, output, error => {
      if (error && !output.destroyed) output.destroy(error)
    })
    return output
  })
}
