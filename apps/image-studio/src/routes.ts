// Роуты студии картинок: галерея разговора вида images, загрузка, чтение,
// переименование, удаление и два действия модели — «нарисовать по промпту» и
// «поправить выбранную по промпту». Доступ — владелец разговора; чужой и
// несуществующий неотличимы (404), как везде в Make/чатах.
import sharp from 'sharp'
import { Readable } from 'node:stream'
import { createHash, randomUUID } from 'node:crypto'
import type { ImageStudioPublicationSettings, ImageStudioFile, ImageStudioTask, ImageStudioTaskInput } from '@voicechat/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { countRu, IMAGE_STUDIO_LIMITS, imageStudioMime, isImageStudioConversation, type ImageStudioSelection } from '@voicechat/shared'
import type { ImageStudioCore, ImageStudioGenerator } from './core.js'
import { SlidingWindowLimiter } from '@voicechat/shared'
import { ImageStudioError, type ImageStudioStore } from './studio.js'
import { extractImageStudioSelection, ImageStudioSelectionError, placeImageStudioObject, retouchImageStudioSelection } from './selection.js'

export interface ImageStudioRoutesDeps {
  core: Pick<ImageStudioCore, 'conversation' | 'renameConversation'>
  store: ImageStudioStore
  /** Генератор изображений; функцией — в тестах подменяется фейком. */
  generator?: (userId: string) => Promise<ImageStudioGenerator>
  /** Счётчик попыток пароля публичной галереи; в тестах — со своими часами. */
  passwordLimiter?: SlidingWindowLimiter
}

function sendStudioError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ImageStudioSelectionError) return reply.code(400).send({ error: error.message })
  if (error instanceof ImageStudioError) {
    const code = error.code === 'not_found' ? 404 : error.code === 'quota' || error.code === 'too_big' ? 413 : 400
    return reply.code(code).send({ error: error.message })
  }
  return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) })
}

async function* studioZip(files: Array<{ path: string; data: () => Promise<Buffer | null> }>): AsyncGenerator<Buffer> {
  const directory: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = await file.data()
    if (!data) throw new Error(`File disappeared: ${file.path}`)
    const name = Buffer.from(file.path)
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)
    offset += local.length + name.length + data.length
    yield local
    yield name
    yield data
  }
  const centralOffset = offset
  for (const part of directory) { yield part; offset += part.length }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(offset - centralOffset, 12)
  end.writeUInt32LE(centralOffset, 16)
  yield end
}

export function registerImageStudioRoutes(app: FastifyInstance, deps: ImageStudioRoutesDeps): void {
  const { core, store } = deps
  const uid = (req: FastifyRequest): string => (req as unknown as { user?: { name: string } | null }).user?.name ?? ''
  // Один ран на разговор: параллельные генерации дерутся за имена и квоту, а
  // пользователю всё равно нужен один результат. Здесь же живёт ручка отмены.
  const activeRuns = new Map<string, { cancel: () => void; cancelled: boolean }>()
  const tasks = new Map<string, { task: ImageStudioTask; work: (run: { cancelled: boolean; onCancel: (fn: () => void) => void }, saving: () => void) => Promise<ImageStudioFile> }>()
  const pump = (conversationId: string): void => {
    if (closing || activeRuns.has(conversationId)) return
    const entry = [...tasks.values()].find(({ task }) => task.conversationId === conversationId && task.state === 'queued')
    if (!entry) return
    const { task, work } = entry
    let stop: (() => void) | undefined
    const run = {
      cancelled: false,
      cancel() { if (!run.cancelled) { run.cancelled = true; stop?.() } },
      onCancel(fn: () => void) { stop = fn; if (run.cancelled) fn() }
    }
    activeRuns.set(conversationId, run)
    task.state = 'running'
    task.updatedAt = Date.now()
    void (async () => {
      try {
        task.file = await work(run, () => {
          if (run.cancelled) throw new Error('Генерация отменена')
          task.state = 'saving'
          task.updatedAt = Date.now()
        })
        task.state = 'completed'
      } catch (error) {
        task.state = run.cancelled ? 'cancelled' : 'failed'
        if (!run.cancelled) task.error = error instanceof Error ? error.message : String(error)
      } finally {
        task.updatedAt = Date.now()
        activeRuns.delete(conversationId)
        pump(conversationId)
      }
    })()
  }
  let closing = false

  app.addHook('preClose', async () => { closing = true; for (const { task } of tasks.values()) if (task.state === 'queued') task.state = 'cancelled'; for (const run of activeRuns.values()) run.cancel() })

  const withRun = async (conversationId: string, reply: FastifyReply, body: (run: { cancel: () => void; cancelled: boolean; onCancel: (fn: () => void) => void }) => Promise<FastifyReply | object>): Promise<FastifyReply | object> => {
    // Проверка владельца по HTTP могла закончиться уже после начала остановки.
    if (closing) return reply.code(503).send({ error: 'image_studio_unavailable' })
    if (activeRuns.has(conversationId)) return reply.code(409).send({ error: 'По этому чату уже идёт генерация — дождитесь её или отмените' })
    const entry = { cancel: () => { entry.cancelled = true }, cancelled: false, onCancel: (fn: () => void) => { entry.cancel = () => { entry.cancelled = true; fn() }; if (entry.cancelled) fn() } }
    activeRuns.set(conversationId, entry)
    try {
      return await body(entry)
    } catch (error) {
      if (entry.cancelled) return reply.code(410).send({ error: 'Генерация отменена' })
      return sendStudioError(reply, error)
    } finally {
      activeRuns.delete(conversationId)
      pump(conversationId)
    }
  }

  /** Разговор пользователя вида «студия картинок», иначе 404. */
  const own = async (userId: string, id: string, reply: FastifyReply): Promise<boolean> => {
    const conversation = await core.conversation(userId, id)
    if (!conversation || !isImageStudioConversation(conversation)) {
      void reply.code(404).send({ error: 'conversation not found' })
      return false
    }
    return true
  }

  const executeGeneration = async (
    userId: string,
    id: string,
    input: ImageStudioTaskInput,
    run: { cancelled: boolean; onCancel: (fn: () => void) => void },
    saving: () => void = () => undefined
  ): Promise<ImageStudioFile> => {
    const startedAt = Date.now()
    const prompt = input.prompt.trim()
    const parameters = input.parameters
    const fullPrompt = [prompt, parameters?.style ? `Стиль: ${parameters.style}.` : '', parameters?.size ? `Размер изображения: ${parameters.size.replace('×', 'x')}` : '', parameters?.negative ? `Не должно быть на изображении: ${parameters.negative}.` : '', parameters?.noText ? 'Не добавляй на изображение никакой текст, надписи и водяные знаки.' : ''].filter(Boolean).join('\n')
    const source = input.path ? await store.readBuffer(id, input.path) : undefined
    if (input.path && !source) throw new ImageStudioError('not_found', 'Исходник больше не существует')
    const references: Array<{ name: string; data: Buffer }> = []
    for (const name of (input.references ?? []).slice(0, 4)) {
      const data = await store.readBuffer(id, name)
      if (!data) throw new ImageStudioError('not_found', `Референс «${name}» не найден`)
      references.push({ name, data })
    }
    const data = await (await deps.generator!(userId))({ prompt: fullPrompt, ...(source ? { source, sourceName: input.path } : {}), ...(references.length ? { references } : {}), onCancel: run.onCancel })
    if (run.cancelled) throw new Error('Генерация отменена')
    saving()
    const name = await store.freeName(id, input.name?.trim() || input.path || 'изображение.png')
    const file = await store.writeBuffer(id, name, data)
    const meta = { prompt, parameters, ...(input.path ? { source: input.path } : {}), operation: input.path ? 'edit' as const : 'generate' as const, tookMs: Date.now() - startedAt }
    await store.setMeta(id, name, meta)
    const conversation = await core.conversation(userId, id)
    if (conversation && /^Картинки \d+$/.test(conversation.title)) await core.renameConversation(userId, id, `Картинки: ${prompt.slice(0, 40)}${prompt.length > 40 ? '…' : ''}`)
    return { ...file, ...meta }
  }

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/tasks', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    return [...tasks.values()].filter(({ task }) => task.conversationId === req.params.id).map(({ task }) => task)
  })

  app.delete<{ Params: { id: string; taskId: string } }>('/api/image-studio/:id/tasks/:taskId', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    const task = tasks.get(req.params.taskId)?.task
    if (!task || task.conversationId !== req.params.id || !['queued', 'running'].includes(task.state)) return { cancelled: false }
    if (task.state === 'queued') { task.state = 'cancelled'; task.updatedAt = Date.now() }
    else activeRuns.get(req.params.id)?.cancel()
    return { cancelled: true }
  })

  app.post<{ Params: { id: string }; Body: ImageStudioTaskInput }>('/api/image-studio/:id/tasks', async (req, reply) => {
    const userId = uid(req)
    const id = req.params.id
    if (!await own(userId, id, reply)) return reply
    if (closing || !deps.generator) return reply.code(503).send({ error: 'Генерация недоступна' })
    const input = req.body
    if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars) return reply.code(400).send({ error: 'Недопустимый промпт' })
    if (input.parameters && (typeof input.parameters !== 'object' || Object.keys(input.parameters).some(key => !['style', 'negative', 'size', 'noText'].includes(key)))) return reply.code(400).send({ error: 'Неподдерживаемые параметры' })
    const list = [...tasks.values()].filter(({ task }) => task.conversationId === id)
    if (list.filter(({ task }) => ['queued', 'running', 'saving'].includes(task.state)).length >= 50) return reply.code(429).send({ error: 'Очередь заполнена' })
    try {
      if (input.path && !await store.readBuffer(id, input.path)) return reply.code(404).send({ error: 'файл не найден' })
      const prompt = input.prompt.trim()
      const parameters = input.parameters
      if (parameters && (['style', 'negative', 'size'] as const).some(key => parameters[key] !== undefined && typeof parameters[key] !== 'string')) return reply.code(400).send({ error: 'Недопустимые параметры' })
      const fullPrompt = [prompt, parameters?.style ? `Стиль: ${parameters.style}.` : '', parameters?.size ? `Размер изображения: ${parameters.size.replace('×', 'x')}` : '', parameters?.negative ? `Не должно быть на изображении: ${parameters.negative}.` : '', parameters?.noText ? 'Не добавляй на изображение никакой текст, надписи и водяные знаки.' : ''].filter(Boolean).join('\n')
      if (fullPrompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars) return reply.code(400).send({ error: 'Промпт с параметрами слишком длинный' })
      const now = Date.now()
      const task: ImageStudioTask = { id: randomUUID(), conversationId: id, prompt, state: 'queued', createdAt: now, updatedAt: now }
      for (const { task: old } of list.filter(({ task: old }) => !['queued', 'running', 'saving'].includes(old.state)).slice(0, -49)) tasks.delete(old.id)
      tasks.set(task.id, { task, work: (run, saving) => executeGeneration(userId, id, input, run, saving) })
      pump(id)
      return reply.code(202).send(task)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { path: string; tags: string[] } }>('/api/image-studio/:id/tags', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    if (!Array.isArray(req.body?.tags) || req.body.tags.length > 30 || req.body.tags.some(tag => typeof tag !== 'string' || tag.length > 80)) return reply.code(400).send({ error: 'Не больше 30 тегов по 80 символов' })
    try {
      if (!await store.readBuffer(req.params.id, req.body.path)) return reply.code(404).send({ error: 'файл не найден' })
      await store.setMeta(req.params.id, req.body.path, { ...await store.meta(req.params.id, req.body.path), tags: [...new Set(req.body.tags.map(tag => tag.trim()).filter(Boolean))] })
      return store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  const archives = new Map<string, { userId: string; conversationId: string; paths: string[]; expires: number }>()
  app.post<{ Params: { id: string }; Body: { paths: string[] } }>('/api/image-studio/:id/archive', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    const paths = req.body?.paths
    if (!Array.isArray(paths) || !paths.length || paths.length > 1000 || paths.some(path => typeof path !== 'string')) return reply.code(400).send({ error: 'Выберите от 1 до 1000 файлов' })
    const existing = new Set((await store.list(req.params.id)).map(file => file.path))
    if (paths.some(path => !existing.has(path))) return reply.code(404).send({ error: 'Выбранный файл не найден' })
    for (const [key, entry] of archives) if (entry.expires < Date.now()) archives.delete(key)
    const ticket = randomUUID()
    archives.set(ticket, { userId: uid(req), conversationId: req.params.id, paths: [...new Set(paths)], expires: Date.now() + 60_000 })
    return { url: `/g/archive/${ticket}` }
  })
  app.get<{ Params: { ticket: string } }>('/g/archive/:ticket', async (req, reply) => {
    const archive = archives.get(req.params.ticket)
    archives.delete(req.params.ticket)
    if (!archive || archive.expires < Date.now() || !await own(archive.userId, archive.conversationId, reply)) return reply.code(404).send({ error: 'Архив недоступен' })
    const stream = Readable.from(studioZip(archive.paths.map(path => ({ path, data: () => store.readBuffer(archive.conversationId, path) }))))
    reply.raw.once('close', () => stream.destroy())
    return reply.type('application/zip').header('content-disposition', 'attachment; filename="gallery.zip"').header('cache-control', 'no-store').send(stream)
  })

  const derivedName = async (conversationId: string, source: string, suffix: string): Promise<string> => {
    const dot = source.lastIndexOf('.')
    const stem = dot > 0 ? source.slice(0, dot) : source
    return store.freeName(conversationId, `${stem}-${suffix}.png`)
  }

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/files', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    return store.list(req.params.id)
  })

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/image-studio/:id/file', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    try {
      const data = await store.readBuffer(req.params.id, req.query.path ?? '')
      if (!data) return reply.code(404).send({ error: 'файл не найден' })
      return reply.header('content-type', imageStudioMime(req.query.path ?? '')).send(data)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { path?: string; dataBase64?: string; source?: string } }>('/api/image-studio/:id/file', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    try {
      await store.writeBuffer(req.params.id, req.body?.path ?? '', Buffer.from(req.body?.dataBase64 ?? '', 'base64'))
      // Клиентские обработки (кроп, разметка, поворот…) сообщают исходник —
      // без этого цепочка версий рвётся на первом же локальном действии.
      await store.setMeta(req.params.id, req.body.path ?? '', req.body?.source
        ? { source: req.body.source, operation: 'transform' }
        : { operation: 'upload' })
      return await store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>('/api/image-studio/:id/file', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    try {
      await store.delete(req.params.id, req.query.path ?? '')
      return await store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>('/api/image-studio/:id/rename', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    try {
      await store.rename(req.params.id, req.body?.from ?? '', req.body?.to ?? '')
      return await store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { prompt?: string; name?: string; references?: string[] } }>('/api/image-studio/:id/generate', async (req, reply) => {
    const userId = uid(req)
    if (!await own(userId, req.params.id, reply)) return reply
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return reply.code(400).send({ error: 'Опишите, что нарисовать' })
    if (prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars) return reply.code(400).send({ error: `Промпт длиннее ${IMAGE_STUDIO_LIMITS.maxPromptChars} символов — сократите` })
    if (!deps.generator) return reply.code(503).send({ error: 'Генерация изображений недоступна в этой конфигурации' })
    return withRun(req.params.id, reply, async (run) => {
      const file = await executeGeneration(userId, req.params.id, { prompt, name: req.body?.name, references: req.body?.references }, run)
      return { file, files: await store.list(req.params.id) }
    })
  })

  app.post<{ Params: { id: string }; Body: { path?: string; prompt?: string } }>('/api/image-studio/:id/edit', async (req, reply) => {
    const userId = uid(req)
    if (!await own(userId, req.params.id, reply)) return reply
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return reply.code(400).send({ error: 'Опишите, что изменить' })
    if (prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars) return reply.code(400).send({ error: `Промпт длиннее ${IMAGE_STUDIO_LIMITS.maxPromptChars} символов — сократите` })
    if (!deps.generator) return reply.code(503).send({ error: 'Правка изображений недоступна в этой конфигурации' })
    const sourcePath = req.body?.path ?? ''
    if (!sourcePath) return reply.code(400).send({ error: 'Выберите исходник' })
    return withRun(req.params.id, reply, async (run) => {
      const file = await executeGeneration(userId, req.params.id, { prompt, path: sourcePath }, run)
      return { file, files: await store.list(req.params.id) }
    })
  })

  app.post<{ Params: { id: string }; Body: { path?: string; prompt?: string; selection?: ImageStudioSelection; references?: string[] } }>('/api/image-studio/:id/retouch', { bodyLimit: 6 * 1024 * 1024 }, async (req, reply) => {
    const userId = uid(req)
    if (!await own(userId, req.params.id, reply)) return reply
    const sourcePath = req.body?.path ?? ''
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return reply.code(400).send({ error: 'Опишите, что изменить в выделении' })
    if (!req.body?.selection) return reply.code(400).send({ error: 'Сначала выделите область' })
    if (!deps.generator) return reply.code(503).send({ error: 'Ретушь недоступна в этой конфигурации' })
    return withRun(req.params.id, reply, async (run) => {
      const source = await store.readBuffer(req.params.id, sourcePath)
      if (!source) return reply.code(404).send({ error: 'файл не найден' })
      const references: Buffer[] = []
      for (const name of (req.body?.references ?? []).slice(0, 4)) {
        const reference = await store.readBuffer(req.params.id, name)
        if (!reference) return reply.code(404).send({ error: `Референс «${name}» не найден` })
        references.push(reference)
      }
      const startedAt = Date.now()
      const result = await retouchImageStudioSelection({
        original: source,
        selection: req.body!.selection!,
        prompt,
        references,
        generate: async ({ crop, mask, width, height, references: refs }) => (await deps.generator!(userId))({
          prompt, source: crop, sourceName: 'selection.png', mask, targetSize: { width, height },
          references: refs.map((data, index) => ({ name: `reference-${index + 1}.png`, data })),
          onCancel: run.onCancel
        })
      })
      if (run.cancelled) throw new Error('Генерация отменена')
      const name = await derivedName(req.params.id, sourcePath, 'ретушь')
      const file = await store.writeBuffer(req.params.id, name, result.image)
      await store.setMeta(req.params.id, name, { prompt, source: sourcePath, tookMs: Date.now() - startedAt, operation: 'retouch', selection: result.bounds })
      return { file: { ...file, prompt, source: sourcePath, operation: 'retouch', selection: result.bounds }, files: await store.list(req.params.id) }
    })
  })

  app.post<{ Params: { id: string }; Body: { path?: string; selection?: ImageStudioSelection } }>('/api/image-studio/:id/extract', { bodyLimit: 6 * 1024 * 1024 }, async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    if (!req.body?.selection) return reply.code(400).send({ error: 'Сначала выделите объект' })
    const sourcePath = req.body.path ?? ''
    try {
      const source = await store.readBuffer(req.params.id, sourcePath)
      if (!source) return reply.code(404).send({ error: 'файл не найден' })
      const result = await extractImageStudioSelection(source, req.body.selection)
      const name = await derivedName(req.params.id, sourcePath, 'объект')
      const file = await store.writeBuffer(req.params.id, name, result.image)
      await store.setMeta(req.params.id, name, { source: sourcePath, operation: 'extract', selection: result.bounds })
      return { file: { ...file, source: sourcePath, operation: 'extract', selection: result.bounds }, files: await store.list(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { basePath?: string; objectPath?: string; x?: number; y?: number; width?: number; height?: number } }>('/api/image-studio/:id/place', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    const objectPath = req.body?.objectPath ?? ''
    try {
      const origin = await store.extractionOrigin(req.params.id, objectPath)
      const basePath = req.body?.basePath || origin?.path || ''
      const base = await store.readBuffer(req.params.id, basePath)
      const object = await store.readBuffer(req.params.id, objectPath)
      if (!base || !object) return reply.code(404).send({ error: 'Исходник или объект не найден' })
      const x = req.body?.x ?? origin?.bounds.x ?? 0
      const y = req.body?.y ?? origin?.bounds.y ?? 0
      const image = await placeImageStudioObject({ base, object, x, y, width: req.body?.width ?? origin?.bounds.width, height: req.body?.height ?? origin?.bounds.height })
      const name = await derivedName(req.params.id, basePath, 'с-объектом')
      const file = await store.writeBuffer(req.params.id, name, image)
      const selection = { kind: 'rectangle' as const, x, y, width: req.body?.width ?? origin?.bounds.width ?? 1, height: req.body?.height ?? origin?.bounds.height ?? 1 }
      await store.setMeta(req.params.id, name, { source: basePath, operation: 'place', selection })
      return { file: { ...file, source: basePath, operation: 'place', selection }, files: await store.list(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { currentPath?: string; targetPath?: string } }>('/api/image-studio/:id/restore-version', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    const currentPath = req.body?.currentPath ?? ''
    const targetPath = req.body?.targetPath ?? ''
    try {
      if (!await store.readBuffer(req.params.id, currentPath)) return reply.code(404).send({ error: 'Текущая версия не найдена' })
      const target = await store.readBuffer(req.params.id, targetPath)
      if (!target) return reply.code(404).send({ error: 'Версия для восстановления не найдена' })
      const name = await derivedName(req.params.id, currentPath, 'восстановлено')
      const file = await store.writeBuffer(req.params.id, name, target)
      await store.setMeta(req.params.id, name, { source: currentPath, operation: 'restore', restoredFrom: targetPath })
      return { file: { ...file, source: currentPath, operation: 'restore', restoredFrom: targetPath }, files: await store.list(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/trash', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    return { items: await store.listTrash(req.params.id) }
  })

  // Очистка корзины необратима, поэтому это отдельный метод, а не флаг
  // удаления: случайно нажать «удалить» и потерять файл совсем нельзя.
  app.post<{ Params: { id: string }; Body: { name?: string } | undefined }>('/api/image-studio/:id/trash/purge', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    try {
      const removed = await store.purgeTrash(req.params.id, req.body?.name)
      return { removed, items: await store.listTrash(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { name?: string } }>('/api/image-studio/:id/restore', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    try {
      const name = await store.restore(req.params.id, req.body?.name ?? '')
      return { name, files: await store.list(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { path?: string; to?: string; copy?: boolean } }>('/api/image-studio/:id/transfer', async (req, reply) => {
    const userId = uid(req)
    if (!await own(userId, req.params.id, reply)) return reply
    const to = req.body?.to ?? ''
    // Целевой чат — тоже студия этого же пользователя, иначе 404 без деталей.
    if (to === req.params.id || !await own(userId, to, reply)) return reply
    try {
      const name = await store.transfer(req.params.id, req.body?.path ?? '', to, req.body?.copy ? 'copy' : 'move')
      return { name, files: await store.list(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  const previews = new Map<string, { conversationId: string; userId: string; expires: number; publication: { title: string; settings: ImageStudioPublicationSettings } }>()
  const publicTarget = async (token: string): Promise<string | null> => {
    const preview = previews.get(token)
    if (!preview) return store.publishedTarget(token)
    if (preview.expires < Date.now()) { previews.delete(token); return null }
    const conversation = await core.conversation(preview.userId, preview.conversationId)
    return conversation && isImageStudioConversation(conversation) ? preview.conversationId : null
  }
  const validatePublication = async (id: string, settings: ImageStudioPublicationSettings): Promise<void> => {
    const files = new Set((await store.list(id)).map(file => file.path))
    if (!Array.isArray(settings.items) || !settings.items.length || settings.items.length > 1000 || settings.items.some(item => !item || !files.has(item.path) || typeof item.caption !== 'string' || item.caption.length > 1000) || new Set(settings.items.map(item => item.path)).size !== settings.items.length) throw new ImageStudioError('bad_path', 'Проверьте состав публикации и подписи')
    if (settings.watermark && (typeof settings.watermark.text !== 'string' || settings.watermark.text.length > 120 || !['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(settings.watermark.position))) throw new ImageStudioError('bad_path', 'Проверьте водяной знак (до 120 символов)')
  }
  app.post<{ Params: { id: string }; Body: { settings: ImageStudioPublicationSettings } }>('/api/image-studio/:id/preview', async (req, reply) => {
    const userId = uid(req)
    if (!await own(userId, req.params.id, reply)) return reply
    try {
      if (!req.body?.settings) return reply.code(400).send({ error: 'Задайте состав публикации' })
      await validatePublication(req.params.id, req.body.settings)
      for (const [token, entry] of previews) if (entry.expires < Date.now()) previews.delete(token)
      const owned = [...previews.entries()].filter(([, entry]) => entry.userId === userId)
      for (const [token] of owned.slice(0, -19)) previews.delete(token)
      const token = randomUUID().replace(/-/g, '')
      const title = (await core.conversation(userId, req.params.id))?.title ?? 'Галерея'
      previews.set(token, { conversationId: req.params.id, userId, expires: Date.now() + 5 * 60_000, publication: { title, settings: req.body.settings } })
      return { url: `/g/${token}/` }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { password?: string | null; settings?: import('@voicechat/shared').ImageStudioPublicationSettings } | undefined }>('/api/image-studio/:id/publish', async (req, reply) => {
    const userId = uid(req)
    if (!await own(userId, req.params.id, reply)) return reply
    try {
      const settings = req.body?.settings
      if (settings) await validatePublication(req.params.id, settings)
      const title = (await core.conversation(userId, req.params.id))?.title ?? null
      const raw = await store.publish(req.params.id, { title, ...(settings ? { settings } : {}), ...(req.body?.password !== undefined ? { password: req.body.password } : {}) })
      return { url: `/g/${raw.token}/`, publishedAt: raw.publishedAt, views: raw.views, passwordProtected: Boolean(raw.passwordHash) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/publication', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    const raw = await store.publication(req.params.id)
    if (!raw) return { url: null }
    // Сводка недели — по дням из sidecar; сами дни наружу не нужны.
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const views7 = Object.entries(raw.days ?? {}).filter(([day]) => day >= weekAgo).reduce((sum, [, count]) => sum + count, 0)
    return { url: `/g/${raw.token}/`, publishedAt: raw.publishedAt, views: raw.views, views7, settings: raw.settings, passwordProtected: Boolean(raw.passwordHash) }
  })

  app.delete<{ Params: { id: string } }>('/api/image-studio/:id/publish', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    await store.unpublish(req.params.id)
    return { url: null }
  })

  // Публичная страница галереи: без авторизации, по непубличному токену.
  // Только чтение и только картинки; noindex, чтобы ссылку не съели роботы.
  /**
   * Пароль публичной галереи можно было подбирать без счёта: у публичного
   * превью Make лимит стоял, а здесь нет. Окно то же — десять попыток за
   * десять минут на пару «IP + токен».
   */
  const passwordLimiter = deps.passwordLimiter ?? new SlidingWindowLimiter(10, 10 * 60_000)
  const gateCookieName = (token: string): string => `vc_gal_${token}`
  const cookieValue = (req: FastifyRequest, name: string): string | null => {
    const m = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${name}=`))
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null
  }
  const passwordPage = (action: string, wrong: boolean, limited = 0): string => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Доступ по паролю</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#f6f7fb;color:#1a1d23}@media (prefers-color-scheme: dark){body{background:#111;color:#eee}form{background:#1c1c1c !important;box-shadow:none !important}input{background:#111;border-color:#333;color:#eee}}form{background:#fff;padding:28px 32px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.08);display:grid;gap:12px;min-width:280px}h1{margin:0;font-size:18px}input{font:inherit;padding:10px 12px;border:1px solid #d9dbe3;border-radius:8px}button{font:inherit;padding:10px 12px;border:0;border-radius:8px;background:#4f7cff;color:#fff;cursor:pointer}.err{color:#c0392b;margin:0;font-size:13px}</style></head>
<body><form method="post" action="${action}"><h1>Галерея защищена паролем</h1>${limited ? `<p class="err">Слишком много попыток — подождите ${limited} с.</p>` : wrong ? '<p class="err">Пароль не подошёл — попробуйте ещё раз.</p>' : ''}<input type="password" name="password" aria-label="Пароль галереи" placeholder="Пароль" autofocus required autocomplete="current-password"><button type="submit">Открыть</button></form></body></html>`

  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(body)))) } catch (e) { done(e as Error, undefined) }
    })
  }

  app.post<{ Params: { token: string }; Body: { password?: string } }>('/g/:token/__auth__', async (req, reply) => {
    const conversationId = await publicTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Галерея не найдена или снята')
    const verdict = passwordLimiter.hit(`${req.ip}:${req.params.token}`)
    if (!verdict.ok) {
      return reply.code(429).header('retry-after', String(verdict.retryAfterSec))
        .header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
        .send(passwordPage(`/g/${req.params.token}/__auth__`, false, verdict.retryAfterSec))
    }
    if (!(await store.verifyPublicPassword(conversationId, req.body?.password ?? ''))) return reply.redirect(`/g/${req.params.token}/?wrong=1`)
    // Вошли — окно попыток по этому токену начинается заново.
    passwordLimiter.forget(`${req.ip}:${req.params.token}`)
    const gate = previews.has(req.params.token) ? null : await store.publicGate(conversationId)
    return reply
      .header('set-cookie', `${gateCookieName(req.params.token)}=${gate ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`)
      .redirect(`/g/${req.params.token}/`)
  })

  app.get<{ Params: { token: string }; Querystring: { wrong?: string } }>('/g/:token/', async (req, reply) => {
    const conversationId = await publicTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Галерея не найдена или снята')
    const gate = previews.has(req.params.token) ? null : await store.publicGate(conversationId)
    if (gate && cookieValue(req, gateCookieName(req.params.token)) !== gate) {
      return reply.code(401).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
        .send(passwordPage(`/g/${req.params.token}/__auth__`, req.query.wrong === '1'))
    }
    if (!previews.has(req.params.token)) void store.countView(conversationId)
    const publication = previews.get(req.params.token)?.publication ?? await store.publication(conversationId)
    const allFiles = await store.list(conversationId)
    const files = publication?.settings ? publication.settings.items.flatMap(item => { const file = allFiles.find(file => file.path === item.path); return file ? [{ ...file, caption: item.caption }] : [] }) : allFiles.map(file => ({ ...file, caption: undefined }))
    const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const cards = files.map((file) => `<figure data-name="${esc(file.path.toLowerCase())}"><a href="file?path=${encodeURIComponent(file.path)}" target="_blank" rel="noopener"><img loading="lazy" src="file?path=${encodeURIComponent(file.path)}" alt="${esc(file.path)}"></a><figcaption>${esc(file.path)} <a class="dl" href="file?path=${encodeURIComponent(file.path)}" download="${esc(file.path)}">скачать</a>${file.caption !== undefined ? `<small>${esc(file.caption)}</small>` : file.prompt ? `<small>${esc(file.prompt)}</small>` : ''}</figcaption></figure>`).join('')
    const title = publication?.title?.trim() || 'Галерея'
    // Вес рядом с числом файлов: зритель решает, качать ли это на телефоне.
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    const totalLabel = totalBytes >= 1024 * 1024
      ? `${(totalBytes / 1024 / 1024).toFixed(1)} МБ`
      : totalBytes >= 1024 ? `${Math.round(totalBytes / 1024)} КБ` : ''
    // OG-мета: мессенджеры делают fetch по ссылке и показывают карточку с
    // первой картинкой — «глухая» ссылка выглядит хуже.
    const origin = `${req.protocol}://${req.headers.host ?? ''}`
    const ogImage = files[0] ? `${origin}/g/${req.params.token}/file?path=${encodeURIComponent(files[0].path)}` : null
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="Галерея из ${countRu(files.length, 'файла', 'файлов', 'файлов')}">${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}<style>
      body{margin:0;padding:24px;font:14px/1.4 system-ui,sans-serif;background:#111;color:#eee}
      @media (prefers-color-scheme: light){body{background:#f6f7fb;color:#1a1d23}figure{background:#fff !important}figcaption small{color:#666 !important}}
      h1{font-size:18px;margin:0 0 16px}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
      figure{margin:0;background:#1c1c1c;border-radius:10px;padding:10px}
      img{width:100%;height:200px;object-fit:contain;background:#fff;border-radius:6px}
      figcaption{margin-top:8px;word-break:break-word}
      figcaption small{display:block;color:#999;margin-top:2px}
      .dl{color:#8ab4f8;text-decoration:none;font-size:12px;margin-left:6px}
      .find{display:flex;gap:8px;align-items:center;margin:0 0 16px;flex-wrap:wrap}
      .find input{flex:0 1 320px;padding:7px 10px;border:1px solid #333;border-radius:8px;background:#191919;color:inherit;font:inherit}
      @media (prefers-color-scheme: light){.find input{background:#fff;border-color:#d5d8e0}}
      .find small{color:#999}
      figure[hidden]{display:none}
    </style></head><body><h1>${esc(title)} · ${countRu(files.length, 'файл', 'файла', 'файлов')}${totalLabel ? ` · ${totalLabel}` : ''}</h1>${files.length >= 12 ? `<form class="find" role="search" onsubmit="return false"><label for="q">Поиск по имени</label><input id="q" type="search" autocomplete="off" placeholder="часть имени файла"><small id="found"></small></form>` : ''}<main class="grid">${cards}</main>${files.length >= 12 ? `<script>
      // Фильтр по имени — на странице, без запросов: галерею на сотню кадров
      // иначе листают руками. Имена лежат в data-name уже в нижнем регистре.
      var q=document.getElementById('q'),found=document.getElementById('found'),cards=[].slice.call(document.querySelectorAll('figure'));
      q.addEventListener('input',function(){
        var needle=q.value.trim().toLowerCase(),shown=0;
        cards.forEach(function(card){var hit=!needle||card.dataset.name.indexOf(needle)>=0;card.hidden=!hit;if(hit)shown++});
        found.textContent=needle?('Найдено: '+shown):'';
      });
    </script>` : ''}</body></html>`
    return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex').send(html)
  })

  app.get<{ Params: { token: string }; Querystring: { path?: string } }>('/g/:token/file', async (req, reply) => {
    const conversationId = await publicTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Галерея не найдена или снята')
    const gate = previews.has(req.params.token) ? null : await store.publicGate(conversationId)
    if (gate && cookieValue(req, gateCookieName(req.params.token)) !== gate) return reply.code(401).type('text/plain; charset=utf-8').send('Галерея защищена паролем')
    try {
      const publication = previews.get(req.params.token)?.publication ?? await store.publication(conversationId)
      if (publication?.settings && !publication.settings.items.some(item => item.path === req.query.path)) return reply.code(404).send({ error: 'файл не найден' })
      let data = await store.readBuffer(conversationId, req.query.path ?? '')
      if (!data) return reply.code(404).send({ error: 'файл не найден' })
      const watermark = publication?.settings?.watermark
      if (watermark?.text) {
        const raster = sharp(data, { limitInputPixels: 64_000_000 }).rotate()
        const { data: pixels, info } = await raster.png().toBuffer({ resolveWithObject: true })
        const font = Math.max(8, Math.round(Math.min(info.width, info.height) / 25))
        const text = watermark.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        const right = watermark.position.endsWith('right')
        const bottom = watermark.position.startsWith('bottom')
        const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}"><text x="${right ? info.width - font : font}" y="${bottom ? info.height - font : font * 2}" text-anchor="${right ? 'end' : 'start'}" font-family="sans-serif" font-size="${font}" fill="white" stroke="black" stroke-width="1" paint-order="stroke">${text}</text></svg>`)
        data = await sharp(pixels).composite([{ input: svg }]).png().toBuffer()
      }
      /**
       * `no-store` заставлял зрителя качать всю галерею заново при каждом
       * заходе и на каждой прокрутке — на девяноста кадрах это заметно даже
       * локально. Отдаём ETag по содержимому и просим браузер переспрашивать
       * (`no-cache`): картинку под тем же именем могли заменить, поэтому
       * молча кэшировать надолго нельзя, а 304 стоит один запрос без тела.
       */
      const etag = `"${createHash('sha1').update(data).digest('hex')}"`
      // Страница галереи помечена `noindex`, а сами картинки — нет: прямую
      // ссылку на файл достаточно один раз где-то опубликовать, чтобы кадр
      // ушёл в поиск по картинкам мимо всей приватности токена.
      reply.header('etag', etag).header('cache-control', 'private, no-cache').header('x-robots-tag', 'noindex, noimageindex')
      if (req.headers['if-none-match'] === etag) return reply.code(304).send()
      return reply.header('content-type', watermark?.text ? 'image/png' : imageStudioMime(req.query.path ?? '')).send(data)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/run', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    return { active: activeRuns.has(req.params.id) }
  })

  app.post<{ Params: { id: string } }>('/api/image-studio/:id/cancel', async (req, reply) => {
    if (!await own(uid(req), req.params.id, reply)) return reply
    const run = activeRuns.get(req.params.id)
    if (!run) return { cancelled: false }
    run.cancel()
    return { cancelled: true }
  })
}
