import { storageBatchResponse } from './batch.js'
import { registerStorageCompression, registerStorageDecompression, storageEncoding } from './compression.js'
import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify'
import { uid } from '@sislexa/identity/server/users/auth'
import { STORAGE_REST, STORAGE_ERROR_STATUS, MAX_STORAGE_FILE_BYTES, STORAGE_THUMBNAIL_SIZES, type CreateStorageUploadRequest, type CreateStorageSpaceRequest, type CreateStorageShareRequest, type StorageThumbnailSize } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from '../../../../packages/file-storage/src/errors.js'
import type { FileStorageService } from '../../../../packages/file-storage/src/service.js'

export function storageError(reply: FastifyReply, error: unknown) {
  if (error instanceof StorageServiceError) return reply.code(STORAGE_ERROR_STATUS[error.code]).send({error: error.code, message: error.message})
  throw error
}
type Request = FastifyRequest<{ Params: {id: string; uploadId: string; n: string; shareId: string; token: string}; Querystring: {path?: string; prefix?: string; size?: string; withContent?: string}; Body: unknown }>
export function registerFileStorageRoutes(root: FastifyInstance, service?: FileStorageService): void {
  root.register(async app => {
  registerStorageCompression(app)
  app.setErrorHandler((error, _req, reply) => {
    const code = (error as {code?: string}).code
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') return storageError(reply, new StorageServiceError('file_too_large'))
    if (code?.startsWith('FST_ERR_CTP_') || code === 'FST_ERR_VALIDATION')
      return storageError(reply, new StorageServiceError('invalid_path'))
    return storageError(reply, error)
  })
  const path = (fn: (id: string) => string) => fn('PARAM').replace('PARAM', ':id')
  const route = (method: HTTPMethods, url: string, handler: (s: FileStorageService, req: Request, reply: FastifyReply) => Promise<unknown>, raw = false) => {
    const register = (scope: FastifyInstance) => scope.route({
      compress: false,
      method, url, bodyLimit: raw ? MAX_STORAGE_FILE_BYTES : 64 * 1024,
      preHandler: async (req, reply) => {
        if (!req.user) return reply.code(401).send({error: 'forbidden', message: 'Sign in required'})
        if (!service) return reply.code(503).send({error: 'storage_disabled', message: 'File storage is disabled'})
      },
      handler: async (req, reply) => {
        try { return await handler(service!, req as Request, reply) }
        catch (error) { return storageError(reply, error) }
      },
    })
    if (raw) app.register(async scope => {
      registerStorageDecompression(scope)
      scope.removeAllContentTypeParsers()
      scope.addContentTypeParser('*', {parseAs: 'buffer'}, (_req, body, done) => done(null, body))
      scope.setErrorHandler((error, _req, reply) => {
        const code = (error as {code?: string}).code
        if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') return storageError(reply, new StorageServiceError('file_too_large'))
        return storageError(reply, error)
      })
      register(scope)
    })
    else register(app)
  }
  const string = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) throw new StorageServiceError('invalid_path')
    return value
  }
  const body = (req: Request): Record<string, unknown> => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new StorageServiceError('invalid_path')
    return req.body as Record<string, unknown>
  }
  const uploads = path(STORAGE_REST.uploads)
  const upload = uploads + '/:uploadId'
  route('POST', uploads, (s, r) => s.createUpload(uid(r), r.params.id, body(r) as unknown as CreateStorageUploadRequest))
  route('GET', upload, (s, r) => s.getUpload(uid(r), r.params.id, r.params.uploadId))
  route('PUT', upload + '/parts/:n', async (s, r, reply) => {
    if (!/^(0|[1-9]\d*)$/.test(r.params.n) || !Buffer.isBuffer(r.body)) throw new StorageServiceError('invalid_path')
    await s.putUploadPart(uid(r), r.params.id, r.params.uploadId, Number(r.params.n), r.body)
    return reply.code(204).send()
  }, true)
  route('POST', upload + '/complete', (s, r) => s.completeUpload(uid(r), r.params.id, r.params.uploadId))
  route('DELETE', upload, async (s, r, reply) => {
    await s.abortUpload(uid(r), r.params.id, r.params.uploadId)
    return reply.code(204).send()
  })
  route('GET', STORAGE_REST.usage, (s, r) => s.usage(uid(r)))
  route('GET', STORAGE_REST.cluster, async (s, r) => {
    if (r.user?.role !== 'admin') throw new StorageServiceError('forbidden')
    return s.cluster(uid(r))
  })
  route('GET', STORAGE_REST.spaces, (s, r) => s.listSpaces(uid(r)))
  route('POST', STORAGE_REST.spaces, (s, r) => {
    const b = body(r)
    string(b.title); string(b.kind)
    if (b.ref != null) string(b.ref)
    return s.createSpace(uid(r), b as unknown as CreateStorageSpaceRequest)
  })
  route('GET', path(STORAGE_REST.space), (s, r) => s.getSpace(uid(r), r.params.id))
  route('PATCH', path(STORAGE_REST.space), (s, r) => s.updateSpace(uid(r), r.params.id, { title: string(body(r).title) }))
  route('POST', path(STORAGE_REST.mergeDuplicates), (s, r) => {
    const b = body(r)
    if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') throw new StorageServiceError('invalid_path')
    if (b.previewToken !== undefined) string(b.previewToken)
    return s.mergeDuplicates(uid(r), r.params.id, { dryRun: b.dryRun as boolean | undefined, previewToken: b.previewToken as string | undefined })
  })
  route('DELETE', path(STORAGE_REST.space), async (s, r, reply) => { await s.deleteSpace(uid(r), r.params.id); return reply.code(204).send() })
  route('GET', path(STORAGE_REST.files), (s, r) => {
    if (r.query.withContent !== undefined && r.query.withContent !== 'small') throw new StorageServiceError('invalid_path')
    return s.listEntries(uid(r), r.params.id, r.query.prefix, r.query.withContent === 'small')
  })
  route('POST', path(STORAGE_REST.batch), async (s, r, reply) => {
    if (r.headers['content-type']?.split(';')[0].trim() !== 'application/x-ndjson') throw new StorageServiceError('unsupported_media_type')
    if (!Buffer.isBuffer(r.body)) throw new StorageServiceError('invalid_path')
    const response = await storageBatchResponse(s, uid(r), r.params.id, r.body, r.headers.range ? undefined : storageEncoding(r.headers['accept-encoding']))
    return reply.type(response.contentType).send(response.stream)
  }, true)
  route('GET', path(STORAGE_REST.file), async (s, r, reply) => {
    const file = await s.readFile(uid(r), r.params.id, string(r.query.path))
    const etag = '"' + file.entry.revision + '"'
    if (r.headers['if-none-match']?.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag)) return reply.code(304).header('etag', etag).send()
    reply.header('etag', etag).header('x-content-type-options', 'nosniff')
    reply.header('content-disposition', 'attachment')
    return reply.type(file.entry.mimeType).send(Buffer.from(file.bytes))
  })
  route('GET', path(STORAGE_REST.thumbnail), async (s, r, reply) => {
    const size = Number(r.query.size)
    if (!STORAGE_THUMBNAIL_SIZES.includes(size as StorageThumbnailSize)) throw new StorageServiceError('invalid_path')
    const thumbnail = await s.readThumbnail(uid(r), r.params.id, string(r.query.path), size as StorageThumbnailSize)
    const etag = `"${thumbnail.entry.revision}-${size}"`
    if (r.headers['if-none-match']?.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag)) return reply.code(304).header('etag', etag).send()
    return reply.header('etag', etag).header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline').type(thumbnail.mimeType).send(Buffer.from(thumbnail.bytes))
  })
  route('PUT', path(STORAGE_REST.file), (s, r) => {
    const match = r.headers['if-match']
    const none = r.headers['if-none-match']
    if (none !== undefined && none !== '*') throw new StorageServiceError('revision_conflict')
    const revision = match === undefined ? undefined : Number(String(match).replace(/^"|"$/g, ''))
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw new StorageServiceError('revision_conflict')
    if (r.body !== undefined && !Buffer.isBuffer(r.body)) throw new StorageServiceError('invalid_path')
    return s.writeFile(uid(r), r.params.id, string(r.query.path), r.body as Buffer ?? Buffer.alloc(0), {
      ifMatch: revision, createOnly: none === '*', mimeType: r.headers['content-type'] ?? 'application/octet-stream',
    })
  }, true)
  route('DELETE', path(STORAGE_REST.file), async (s, r, reply) => { await s.deleteFile(uid(r), r.params.id, string(r.query.path)); return reply.code(204).send() })
  route('POST', path(STORAGE_REST.move), (s, r) => { const b = body(r); return s.move(uid(r), r.params.id, string(b.from), string(b.to)) })
  route('GET', path(STORAGE_REST.shares), (s, r) => s.listShares(uid(r), r.params.id))
  route('POST', path(STORAGE_REST.shares), (s, r) => {
    const b = body(r); string(b.permission); if (b.userId !== undefined) string(b.userId)
    return s.createShare(uid(r), r.params.id, b as unknown as CreateStorageShareRequest)
  })
  route('DELETE', STORAGE_REST.share('PARAM', 'SHARE').replace('PARAM', ':id').replace('SHARE', ':shareId'), async (s, r, reply) => {
    await s.revokeShare(uid(r), r.params.id, r.params.shareId); return reply.code(204).send()
  })
  const link = STORAGE_REST.link('TOKEN').replace('TOKEN', ':token')
  route('GET', link, (s, r) => s.describeLink(uid(r), r.params.token))
  route('POST', link, (s, r) => s.acceptLink(uid(r), r.params.token))
  })
}
