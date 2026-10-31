import type { FastifyInstance } from 'fastify'
import { mkdir, readdir, readFile, writeFile, rename, rm, open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isStorageBlobId, MAX_STORAGE_FILE_BYTES, MAX_STORAGE_UPLOAD_PARTS, STORAGE_UPLOAD_TTL_MS } from '@voicechat/shared/fileStorage'
import { StorageServiceError } from '../errors.js'

interface Manifest { size: number; partSize: number; expiresAt: number; blobId: string }
export async function nodeUploads(directory: string, capacity: number, accounting: {
  used(): number; add(bytes: number): void
  exclusive<T>(fn: () => Promise<T>): Promise<T>
}) {
  const root = join(directory, '.uploads')
  const sessions = new Map<string, Manifest>()
  const composed = new Set<string>()
  const fail = (code: 'invalid_path' | 'not_found' | 'revision_conflict' | 'storage_full'): never => { throw new StorageServiceError(code) }
  const folder = (id: string) => { if (!isStorageBlobId(id)) fail('invalid_path'); return join(root, id) }
  for (const id of await readdir(root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })) {
    if (!isStorageBlobId(id)) continue
    const saved = await readFile(join(folder(id), 'manifest'), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (saved === null) { await rm(folder(id), { recursive: true, force: true }); continue }
    const m: Manifest = JSON.parse(saved)
    for (const name of await readdir(folder(id))) {
      if (name.startsWith('.tmp-')) await rm(join(folder(id), name), { force: true })
    }
    sessions.set(id, m)
    if (await stat(join(directory, m.blobId)).then(() => true, () => false)) composed.add(id)
    accounting.add(m.size * (composed.has(id) ? 1 : 2))
  }
  async function remove(id: string) {
    const m = sessions.get(id)
    if (!m) return
    await rm(folder(id), { recursive: true, force: true })
    accounting.add(-m.size * (composed.has(id) ? 1 : 2))
    sessions.delete(id); composed.delete(id)
  }
  async function expire() {
    for (const [id, m] of sessions) if (m.expiresAt <= Date.now()) await remove(id)
  }
  await expire()
  return (app: FastifyInstance) => {
    const timer = setInterval(() => { void accounting.exclusive(expire).catch(() => {}) }, 60_000)
    timer.unref()
    app.addHook('onClose', async () => { clearInterval(timer); await accounting.exclusive(async () => {}) })
    function get(id: string) {
      folder(id)
      const m = sessions.get(id)
      if (!m || m.expiresAt <= Date.now()) return fail('not_found')
      return m
    }
    const parts = async (id: string) => (await readdir(folder(id))).filter(n => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b)
    app.post<{Params: {id: string}; Body: Buffer}>('/v1/uploads/:id', async (req, reply) => {
      await accounting.exclusive(async () => {
        const id = req.params.id
        const dir = folder(id)
        let m: Manifest
        try { m = JSON.parse(req.body.toString()) } catch { return fail('invalid_path') }
        if (!m || !Number.isSafeInteger(m.size) || m.size < 0 || !Number.isSafeInteger(m.partSize) || m.partSize < 1 ||
          m.partSize > MAX_STORAGE_FILE_BYTES || Math.ceil(m.size / m.partSize) > MAX_STORAGE_UPLOAD_PARTS ||
          !Number.isSafeInteger(m.expiresAt) || m.expiresAt <= Date.now() || m.expiresAt > Date.now() + STORAGE_UPLOAD_TTL_MS ||
          !isStorageBlobId(m.blobId)) fail('invalid_path')
        if (sessions.has(id)) fail('revision_conflict')
        if (accounting.used() + 2 * m.size > capacity) fail('storage_full')
        await mkdir(root, { recursive: true, mode: 0o700 })
        await mkdir(dir, { mode: 0o700 })
        try {
          await writeFile(join(dir, '.tmp-manifest'), JSON.stringify(m), { flag: 'wx', mode: 0o600 })
          await rename(join(dir, '.tmp-manifest'), join(dir, 'manifest'))
        }
        catch (error) { await rm(dir, { recursive: true, force: true }); throw error }
        sessions.set(id, m); accounting.add(2 * m.size)
      })
      return reply.code(204).send()
    })
    app.put<{Params: {id: string; n: string}; Body: Buffer}>('/v1/uploads/:id/parts/:n', async (req, reply) => {
      const {id, n} = req.params
      await accounting.exclusive(async () => {
        const m = get(id); const index = Number(n)
        if (composed.has(id)) fail('revision_conflict')
        if (!/^(0|[1-9]\d*)$/.test(n) || !Number.isSafeInteger(index) || index >= Math.ceil(m.size / m.partSize) ||
          (req.body?.length ?? 0) !== Math.min(m.partSize, m.size - index * m.partSize)) fail('invalid_path')
      })
      const temp = join(folder(id), '.tmp-' + randomUUID())
      try {
        await writeFile(temp, req.body, { flag: 'wx', mode: 0o600 })
        await accounting.exclusive(async () => {
          get(id)
          if (composed.has(id)) fail('revision_conflict')
          await rename(temp, join(folder(id), n))
        })
      } finally { await rm(temp, { force: true }) }
      return reply.code(204).send()
    })
    app.get<{Params: {id: string}}>('/v1/uploads/:id', req => accounting.exclusive(async () => {
      get(req.params.id); return parts(req.params.id)
    }))
    app.post<{Params: {id: string}}>('/v1/uploads/:id/complete', async (req, reply) => {
      await accounting.exclusive(async () => {
        const id = req.params.id; const m = get(id)
        if (composed.has(id)) return
        const count = Math.ceil(m.size / m.partSize)
        if ((await parts(id)).length !== count) fail('revision_conflict')
        const temp = join(directory, '.tmp-' + randomUUID())
        const output = await open(temp, 'wx', 0o600)
        try {
          for (let n = 0; n < count; n++) {
            const bytes = await readFile(join(folder(id), String(n)))
            if (bytes.length !== Math.min(m.partSize, m.size - n * m.partSize)) fail('revision_conflict')
            await output.writeFile(bytes)
          }
          await output.close()
          await rename(temp, join(directory, m.blobId))
          // One reserved copy becomes a published blob; total accounting stays constant.
          composed.add(id)
        } finally { await output.close(); await rm(temp, { force: true }) }
      })
      return reply.code(204).send()
    })
    app.delete<{Params: {id: string}}>('/v1/uploads/:id', async (req, reply) => {
      folder(req.params.id)
      await accounting.exclusive(() => remove(req.params.id))
      return reply.code(204).send()
    })
  }
}
