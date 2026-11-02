import { verifyDirect } from '../direct.js'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { nodeUploads } from "./uploads.js"
import Fastify from 'fastify'
import { copyFile, mkdir, readdir, lstat, readFile, rename, unlink } from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { join } from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { ComponentRuntime } from '@sislexa/component-runtime'
import { FILE_STORAGE_NODE_PATHS, MAX_STORAGE_FILE_BYTES, STORAGE_NODE_SCOPE,
  isStorageBlobId, type StorageNodeHealth } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from '../errors.js'

export interface StorageNodeOptions {
  directSecret?: string
  allowedOrigins?: string[]
  nodeId: string
  directory: string
  capacityBytes: number
  maxFileBytes?: number
  tokenFile?: string
  runtime?: Pick<ComponentRuntime, 'authorize' | 'register'>
}
export async function createStorageNodeServer(options: StorageNodeOptions) {
  if (options.directSecret !== undefined && options.directSecret.length < 32)
    throw new Error('Storage direct secret must contain at least 32 characters')
  if (options.allowedOrigins !== undefined && (!Array.isArray(options.allowedOrigins) || options.allowedOrigins.some(origin => {
    try { return typeof origin !== 'string' || new URL(origin).origin !== origin || !/^https?:/.test(origin) } catch { return true }
  }))) throw new Error('Invalid storage UI origins')
  if (!options.nodeId || !options.directory || !Number.isSafeInteger(options.capacityBytes) || options.capacityBytes < 0)
    throw new Error('Invalid storage node configuration')
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
  const registerUploads = await nodeUploads(options.directory, options.capacityBytes, { used: () => usedBytes, add: n => { usedBytes += n }, exclusive })
  const maxFileBytes = options.maxFileBytes ?? MAX_STORAGE_FILE_BYTES
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) throw new Error("Invalid storage file limit")
  const app = Fastify({ bodyLimit: maxFileBytes, routerOptions: { maxParamLength: 1024 } })
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
    routes.addHook('onRequest', async (req, reply) => {
      if (req.routeOptions.url === '/v1/direct/:blobId') {
        const origin = req.headers.origin
        if (origin) {
          if (!options.allowedOrigins?.includes(origin)) throw new StorageServiceError('forbidden')
          reply.header('access-control-allow-origin', origin).header('vary', 'Origin')
            .header('access-control-allow-methods', 'GET, PUT, OPTIONS')
            .header('access-control-allow-headers', 'Content-Type, Range')
            .header('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges')
        }
        reply.header('cache-control', 'private, no-store')
        if (req.method === 'OPTIONS') return reply.code(204).send()
        const claims = verifyDirect(String((req.query as {sig?: string}).sig ?? ''), options.directSecret ?? '')
        if (claims.blobId !== (req.params as {blobId: string}).blobId || claims.method !== req.method ||
          (req.method === 'PUT' && (req.headers['content-type'] !== claims.mimeType ||
            (req.headers['content-length'] !== undefined && Number(req.headers['content-length']) !== claims.size))))
          throw new StorageServiceError('forbidden')
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
    routes.addContentTypeParser('*', (req, body, done) => {
      if (req.method === 'PUT' && req.routeOptions.url === '/v1/blobs/:blobId') return done(null, body)
      void (async () => {
        try {
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of body) {
            size += chunk.length
            if (size > 64 * 1024 * 1024) throw new StorageServiceError('file_too_large')
            chunks.push(Buffer.from(chunk))
          }
          done(null, Buffer.concat(chunks, size))
        } catch (error) { done(error as Error, undefined) }
      })()
    })
    registerUploads(routes)
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
    routes.post<{ Params: { blobId: string }; Body: Buffer }>('/v1/blobs/:blobId/copy', async (req, reply) => {
      let targetId: unknown
      try { targetId = JSON.parse(req.body.toString()).targetId } catch { throw new StorageServiceError('invalid_path') }
      if (typeof targetId !== 'string') throw new StorageServiceError('invalid_path')
      const source = path(req.params.blobId), target = path(targetId)
      await exclusive(async () => {
        const bytes = await size(source)
        if (bytes === null) throw new StorageServiceError('not_found')
        if (await size(target) !== null) throw new StorageServiceError('revision_conflict')
        if (usedBytes + bytes > options.capacityBytes) throw new StorageServiceError('storage_full')
        const temporary = join(options.directory, '.tmp-' + randomUUID())
        try {
          await copyFile(source, temporary)
          await rename(temporary, target)
          usedBytes += bytes
        } finally {
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
      })
      return reply.code(204).send()
    })
    routes.put<{ Params: { blobId: string }; Body: Readable }>('/v1/blobs/:blobId', async (req, reply) => {
      const file = path(req.params.blobId)
      const body = req.body ?? Readable.from([])
      const declared = req.headers['content-length'] === undefined ? undefined : Number(req.headers['content-length'])
      if (declared !== undefined && declared > maxFileBytes) throw new StorageServiceError('file_too_large')
      await exclusive(async () => {
        const previous = await size(file) ?? 0
        if (declared !== undefined && usedBytes - previous + declared > options.capacityBytes) throw new StorageServiceError('storage_full')
        let received = 0
        const temporary = join(options.directory, '.tmp-' + randomUUID())
        try {
          // Keep the request socket alive long enough to return a structured limit error.
          await pipeline(Readable.from((async function* () {
            const iterator = body.iterator({ destroyOnReturn: false })
            try {
              for await (const chunk of iterator) {
                received += Buffer.byteLength(chunk)
                if (received > maxFileBytes) throw new StorageServiceError('file_too_large')
                if (usedBytes - previous + received > options.capacityBytes) throw new StorageServiceError('storage_full')
                yield chunk
              }
              if (declared !== undefined && received !== declared) throw new StorageServiceError('invalid_path')
            } finally { if (!body.readableEnded) body.resume() }
          })()), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
          await rename(temporary, file)
          usedBytes += received - previous
        } finally {
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
        }
      })
      return reply.code(204).send()
    })
    const readBlob = async (req: FastifyRequest<{Params: {blobId: string}}>, reply: FastifyReply) => {
      await exclusive(async () => {
      const file = path(req.params.blobId)
      const length = await size(file)
      if (length === null) throw new StorageServiceError('not_found')
      const open = async (start?: number, end?: number) => {
        const stream = createReadStream(file, { start, end })
        await new Promise<void>((resolve, reject) => { stream.once('open', () => resolve()); stream.once('error', reject) })
        return stream
      }
      const claims = req.routeOptions.url === '/v1/direct/:blobId'
        ? verifyDirect(String((req.query as {sig?: string}).sig ?? ''), options.directSecret ?? '') : undefined
      if (claims && claims.size !== length) throw new StorageServiceError('revision_conflict')
      reply.header('accept-ranges', 'bytes').type(claims?.mimeType ?? 'application/octet-stream')
      const range = req.headers.range
      if (!range) { reply.header('content-length', length).send(await open()); return }
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match) throw new StorageServiceError('range_not_satisfiable')
      let start: number, end: number
      if (match[1] === '') {
        const suffix = Number(match[2])
        if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new StorageServiceError('range_not_satisfiable')
        start = Math.max(0, length - suffix); end = length - 1
      } else {
        start = Number(match[1]); end = match[2] === '' ? length - 1 : Number(match[2])
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new StorageServiceError('range_not_satisfiable')
        if (start >= length) { reply.code(416).header('content-range', `bytes */${length}`).send(); return }
        if (start > end) throw new StorageServiceError('range_not_satisfiable')
        end = Math.min(end, length - 1)
      }
      reply.code(206).header('content-range', `bytes ${start}-${end}/${length}`)
        .header('content-length', end - start + 1).send(await open(start, end))
      })
      return reply
    }
    routes.get('/v1/blobs/:blobId', readBlob)
    routes.get('/v1/direct/:blobId', readBlob)
    routes.options('/v1/direct/:blobId', async (_req, reply) => reply.code(204).send())
    routes.put<{Body: Buffer}>('/v1/direct/:blobId', async (req, reply) => {
      const claims = verifyDirect(String((req.query as {sig?: string}).sig ?? ''), options.directSecret ?? '')
      if ((req.body?.length ?? 0) !== claims.size) throw new StorageServiceError('invalid_path')
      await registerUploads.directPut(claims, req.body ?? Buffer.alloc(0))
      return reply.code(204).send()
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
