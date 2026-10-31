import { nodeUploads } from "./uploads.js"
import Fastify from 'fastify'
import { open, copyFile, mkdir, readdir, lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { ComponentRuntime } from '@sislexa/component-runtime'
import { FILE_STORAGE_NODE_PATHS, MAX_STORAGE_FILE_BYTES, STORAGE_NODE_SCOPE,
  storageByteRange, isStorageBlobId, type StorageNodeHealth } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from '../errors.js'

export interface StorageNodeOptions {
  nodeId: string
  directory: string
  capacityBytes: number
  tokenFile?: string
  runtime?: Pick<ComponentRuntime, 'authorize' | 'register'>
}
export async function createStorageNodeServer(options: StorageNodeOptions) {
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
    routes.addHook('onRequest', async (req, reply) => {
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
    routes.get<{ Params: { blobId: string } }>('/v1/blobs/:blobId', async (req, reply) => {
      const file = path(req.params.blobId)
      const handle = await exclusive(async () => {
        if (await size(file) === null) throw new StorageServiceError('not_found')
        return open(file, 'r')
      })
      try {
        const total = (await handle.stat()).size
        const range = storageByteRange(req.headers.range, total)
        reply.header('accept-ranges', 'bytes')
        if (range === 'unsatisfiable') {
          await handle.close()
          return reply.code(416).header('content-range', `bytes */${total}`).send()
        }
        if (range) reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${total}`)
        reply.header('content-length', range ? range.end - range.start + 1 : total)
        return reply.type('application/octet-stream').send(handle.createReadStream(range ?? {}))
      } catch (error) {
        await handle.close()
        throw error
      }
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
