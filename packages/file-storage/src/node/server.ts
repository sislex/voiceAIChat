import Fastify from 'fastify'
import { createReadStream } from 'node:fs'
import { verifyDirectUrl, type DirectClaims } from '../client.js'
import { mkdir, readdir, lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { ComponentRuntime } from '@sislexa/component-runtime'
import { FILE_STORAGE_NODE_PATHS, MAX_STORAGE_FILE_BYTES, STORAGE_NODE_SCOPE,
  isStorageBlobId, type StorageNodeHealth } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from '../errors.js'

export interface StorageNodeOptions {
  nodeId: string
  directory: string
  capacityBytes: number
  directSecret?: string
  corsOrigins?: string[]
  tokenFile?: string
  runtime?: Pick<ComponentRuntime, 'authorize' | 'register'>
}
export async function createStorageNodeServer(options: StorageNodeOptions) {
  if (!options.nodeId || !options.directory || !Number.isSafeInteger(options.capacityBytes) || options.capacityBytes < 0)
    throw new Error('Invalid storage node configuration')
  if (options.directSecret !== undefined && Buffer.byteLength(options.directSecret) < 32)
    throw new Error('Storage direct secret must contain at least 32 bytes')
  await mkdir(options.directory, { recursive: true, mode: 0o700 })
  let usedBytes = 0
  for (const name of await readdir(options.directory)) {
    if (!isStorageBlobId(name)) continue
    const stat = await lstat(join(options.directory, name))
    if (!stat.isFile()) throw new Error('Storage directory contains a non-regular blob')
    usedBytes += stat.size
  }
  // One process owns a directory. Serialize mutations to reserve capacity atomically.
  let queue: Promise<unknown> = Promise.resolve()
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn)
    queue = result.catch(() => {})
    return result
  }
  const app = Fastify({ bodyLimit: MAX_STORAGE_FILE_BYTES, routerOptions: { maxParamLength: 1024 } })
  options.runtime?.register(app)
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof StorageServiceError)
      return reply.code(error.statusCode).send({ error: error.code, message: error.message })
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOSPC' || code === 'EDQUOT')
      return reply.code(507).send({ error: 'storage_full', message: 'Storage capacity exhausted' })
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE')
      return reply.code(413).send({ error: 'file_too_large', message: 'File too large' })
    return reply.code(503).send({ error: 'node_unavailable', message: 'Storage node unavailable' })
  })
  await app.register(async routes => {
    const claims = new WeakMap<object, DirectClaims>()
    routes.addHook('onRequest', async (req, reply) => {
      if (req.routeOptions.url === '/v1/direct/:blobId') {
        reply.header('cache-control', 'no-store').header('vary', 'Origin')
        const origin = req.headers.origin
        if (origin && options.corsOrigins?.includes(origin)) {
          reply.header('access-control-allow-origin', origin)
          reply.header('access-control-allow-methods', 'GET, PUT, OPTIONS')
          reply.header('access-control-allow-headers', 'Content-Type, Range')
          reply.header('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges')
        } else if (origin) throw new StorageServiceError('forbidden')
        if (req.method === 'OPTIONS') return reply.code(204).send()
        const { blobId } = req.params as { blobId: string }
        const { sig } = req.query as { sig: string }
        const c = verifyDirectUrl(sig, options.directSecret ?? '', blobId, req.method)
        if (req.method === 'PUT' && (req.headers['content-type'] !== c.mimeType ||
            (req.headers['content-length'] !== undefined && Number(req.headers['content-length']) !== c.size)))
          throw new StorageServiceError('invalid_path')
        claims.set(req, c)
        return
      }
      if (options.runtime) {
        const result = options.runtime.authorize(req.headers.authorization, STORAGE_NODE_SCOPE)
        if (!result.ok) return reply.code(result.status).send({ error: 'forbidden', message: 'Authentication required' })
        return
      }
      let token = ''
      try { if (options.tokenFile) token = (await readFile(options.tokenFile, 'utf8')).trim() } catch { /* Fail closed. */ }
      const expected = Buffer.from('Bearer ' + token)
      const actual = Buffer.from(req.headers.authorization ?? '')
      if (!token || actual.length !== expected.length || !timingSafeEqual(actual, expected))
        return reply.code(401).send({ error: 'forbidden', message: 'Authentication required' })
    })
    routes.removeAllContentTypeParsers()
    routes.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))
    routes.get(FILE_STORAGE_NODE_PATHS.health, async (): Promise<StorageNodeHealth> => ({
      nodeId: options.nodeId, capacityBytes: options.capacityBytes, usedBytes,
      freeBytes: Math.max(0, options.capacityBytes - usedBytes),
    }))
    function path(id: string) {
      if (!isStorageBlobId(id)) throw new StorageServiceError('invalid_path')
      return join(options.directory, id)
    }
    async function size(file: string): Promise<number | null> {
      try {
        const stat = await lstat(file)
        if (!stat.isFile()) throw new StorageServiceError('invalid_path')
        return stat.size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    }
    routes.options('/v1/direct/:blobId', async (_req, reply) => reply.code(204).send())
    routes.put<{ Params: { blobId: string }; Body: Buffer }>('/v1/direct/:blobId', async (req, reply) => {
      const c = claims.get(req)!
      const bytes = req.body ?? Buffer.alloc(0)
      if (bytes.length !== c.size) throw new StorageServiceError('invalid_path')
      const file = path(c.blobId)
      await exclusive(async () => {
        if (c.expiresAt <= Date.now()) throw new StorageServiceError('forbidden')
        // Direct capabilities create immutable blobs, including after metadata commit.
        if (await size(file) !== null) throw new StorageServiceError('revision_conflict')
        if (usedBytes + bytes.length > options.capacityBytes) throw new StorageServiceError('storage_full')
        const temporary = join(options.directory, '.tmp-' + randomUUID())
        try {
          await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
          if (c.expiresAt <= Date.now()) throw new StorageServiceError('forbidden')
          await rename(temporary, file)
          usedBytes += bytes.length
        } finally {
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
      })
      return reply.code(204).send()
    })
    routes.get<{ Params: { blobId: string } }>('/v1/direct/:blobId', { exposeHeadRoute: false }, async (req, reply) => {
      const c = claims.get(req)!
      const file = path(c.blobId)
      const length = await size(file)
      if (length === null) throw new StorageServiceError('not_found')
      if (length !== c.size) throw new StorageServiceError('revision_conflict')
      reply.type(c.mimeType).header('x-content-type-options', 'nosniff')
        .header('content-disposition', 'attachment').header('accept-ranges', 'bytes')
      let start = 0, end = length - 1
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
        if (!match || (!match[1] && !match[2])) return reply.code(416).header('content-range', 'bytes */' + length).send()
        start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]))
        end = match[1] && match[2] ? Math.min(Number(match[2]), length - 1) : length - 1
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= length)
          return reply.code(416).header('content-range', 'bytes */' + length).send()
        reply.code(206).header('content-range', `bytes ${start}-${end}/${length}`)
      }
      reply.header('content-length', Math.max(0, end - start + 1))
      return length ? reply.send(createReadStream(file, { start, end })) : reply.send(Buffer.alloc(0))
    })
    routes.head<{ Params: { blobId: string } }>('/v1/blobs/:blobId', async (req, reply) => {
      const length = await size(path(req.params.blobId))
      if (length === null) throw new StorageServiceError('not_found')
      return reply.header('content-length', length).send()
    })
    routes.put<{ Params: { blobId: string }; Body: Buffer }>('/v1/blobs/:blobId', async (req, reply) => {
      const file = path(req.params.blobId)
      const bytes = req.body ?? Buffer.alloc(0)
      await exclusive(async () => {
        const previous = await size(file) ?? 0
        if (usedBytes - previous + bytes.length > options.capacityBytes) throw new StorageServiceError('storage_full')
        const temporary = join(options.directory, '.tmp-' + randomUUID())
        try {
          await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
          await rename(temporary, file)
          usedBytes += bytes.length - previous
        } finally {
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
      })
      return reply.code(204).send()
    })
    routes.get<{ Params: { blobId: string } }>('/v1/blobs/:blobId', { exposeHeadRoute: false }, async (req, reply) => {
      const file = path(req.params.blobId)
      const bytes = await exclusive(async () => {
        if (await size(file) === null) throw new StorageServiceError('not_found')
        return readFile(file)
      })
      return reply.type('application/octet-stream').send(bytes)
    })
    routes.delete<{ Params: { blobId: string } }>('/v1/blobs/:blobId', async (req, reply) => {
      const file = path(req.params.blobId)
      await exclusive(async () => {
        const previous = await size(file)
        if (previous !== null) { await unlink(file); usedBytes -= previous }
      })
      return reply.code(204).send()
    })
  })
  return app
}
