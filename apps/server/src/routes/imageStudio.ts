// Роуты студии картинок: галерея разговора вида images, загрузка, чтение,
// переименование, удаление и два действия модели — «нарисовать по промпту» и
// «поправить выбранную по промпту». Доступ — владелец разговора; чужой и
// несуществующий неотличимы (404), как везде в Make/чатах.
import type { FastifyInstance, FastifyReply } from 'fastify'
import { IMAGE_STUDIO_LIMITS, imageStudioMime, isImageStudioConversation } from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import { ImageStudioError, type ImageStudioStore } from '../images/studio.js'
import type { ImageStudioGenerator } from '../llm/imageStudioGenerator.js'

export interface ImageStudioRoutesDeps {
  db: VoiceChatDb
  store: ImageStudioStore
  /** Генератор изображений; функцией — в тестах подменяется фейком. */
  generator?: (userId: string) => ImageStudioGenerator
}

function sendStudioError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ImageStudioError) {
    const code = error.code === 'not_found' ? 404 : error.code === 'quota' || error.code === 'too_big' ? 413 : 400
    return reply.code(code).send({ error: error.message })
  }
  return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) })
}

export function registerImageStudioRoutes(app: FastifyInstance, deps: ImageStudioRoutesDeps): void {
  const { db, store } = deps
  const uid = (req: { user?: { name: string } | null }): string => req.user?.name ?? ''
  // Один ран на разговор: параллельные генерации дерутся за имена и квоту, а
  // пользователю всё равно нужен один результат. Здесь же живёт ручка отмены.
  const activeRuns = new Map<string, { cancel: () => void; cancelled: boolean }>()

  const withRun = async (conversationId: string, reply: FastifyReply, body: (run: { cancel: () => void; cancelled: boolean; onCancel: (fn: () => void) => void }) => Promise<FastifyReply | object>): Promise<FastifyReply | object> => {
    if (activeRuns.has(conversationId)) return reply.code(409).send({ error: 'По этому чату уже идёт генерация — дождитесь её или отмените' })
    const entry = { cancel: () => { entry.cancelled = true }, cancelled: false, onCancel: (fn: () => void) => { entry.cancel = () => { entry.cancelled = true; fn() } } }
    activeRuns.set(conversationId, entry)
    try {
      return await body(entry)
    } catch (error) {
      if (entry.cancelled) return reply.code(410).send({ error: 'Генерация отменена' })
      return sendStudioError(reply, error)
    } finally {
      activeRuns.delete(conversationId)
    }
  }

  /** Разговор пользователя вида «студия картинок», иначе 404. */
  const own = (userId: string, id: string, reply: FastifyReply): boolean => {
    const conversation = db.getConversation(userId, id)
    if (!conversation || !isImageStudioConversation(conversation)) {
      void reply.code(404).send({ error: 'conversation not found' })
      return false
    }
    return true
  }

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/files', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    return store.list(req.params.id)
  })

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/image-studio/:id/file', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      const data = await store.readBuffer(req.params.id, req.query.path ?? '')
      if (!data) return reply.code(404).send({ error: 'файл не найден' })
      return reply.header('content-type', imageStudioMime(req.query.path ?? '')).send(data)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { path?: string; dataBase64?: string } }>('/api/image-studio/:id/file', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await store.writeBuffer(req.params.id, req.body?.path ?? '', Buffer.from(req.body?.dataBase64 ?? '', 'base64'))
      return store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>('/api/image-studio/:id/file', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await store.delete(req.params.id, req.query.path ?? '')
      return store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>('/api/image-studio/:id/rename', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await store.rename(req.params.id, req.body?.from ?? '', req.body?.to ?? '')
      return store.list(req.params.id)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { prompt?: string; name?: string } }>('/api/image-studio/:id/generate', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return reply.code(400).send({ error: 'Опишите, что нарисовать' })
    if (prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars) return reply.code(400).send({ error: `Промпт длиннее ${IMAGE_STUDIO_LIMITS.maxPromptChars} символов — сократите` })
    if (!deps.generator) return reply.code(503).send({ error: 'Генерация изображений недоступна в этой конфигурации' })
    return withRun(req.params.id, reply, async (run) => {
      const data = await deps.generator!(userId)({ prompt, onCancel: run.onCancel })
      const name = await store.freeName(req.params.id, (req.body?.name ?? '').trim() || 'изображение.png')
      const file = await store.writeBuffer(req.params.id, name, data)
      await store.setMeta(req.params.id, name, { prompt })
      return { file: { ...file, prompt }, files: await store.list(req.params.id) }
    })
  })

  app.post<{ Params: { id: string }; Body: { path?: string; prompt?: string } }>('/api/image-studio/:id/edit', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return reply.code(400).send({ error: 'Опишите, что изменить' })
    if (prompt.length > IMAGE_STUDIO_LIMITS.maxPromptChars) return reply.code(400).send({ error: `Промпт длиннее ${IMAGE_STUDIO_LIMITS.maxPromptChars} символов — сократите` })
    if (!deps.generator) return reply.code(503).send({ error: 'Правка изображений недоступна в этой конфигурации' })
    const sourcePath = req.body?.path ?? ''
    return withRun(req.params.id, reply, async (run) => {
      const source = await store.readBuffer(req.params.id, sourcePath)
      if (!source) return reply.code(404).send({ error: 'файл не найден' })
      const data = await deps.generator!(userId)({ prompt, source, sourceName: sourcePath || 'source.png', onCancel: run.onCancel })
      // Правка не затирает оригинал: результат — новый файл рядом. Откат — это
      // просто удаление новой версии, истории снимков студии не нужно.
      const name = await store.freeName(req.params.id, sourcePath || 'правка.png')
      const file = await store.writeBuffer(req.params.id, name, data)
      await store.setMeta(req.params.id, name, { prompt, source: sourcePath })
      return { file: { ...file, prompt, source: sourcePath }, files: await store.list(req.params.id) }
    })
  })

  app.post<{ Params: { id: string } }>('/api/image-studio/:id/publish', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    const raw = await store.publish(req.params.id)
    return { url: `/g/${raw.token}/`, publishedAt: raw.publishedAt, views: raw.views }
  })

  app.get<{ Params: { id: string } }>('/api/image-studio/:id/publication', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    const raw = await store.publication(req.params.id)
    return raw ? { url: `/g/${raw.token}/`, publishedAt: raw.publishedAt, views: raw.views } : { url: null }
  })

  app.delete<{ Params: { id: string } }>('/api/image-studio/:id/publish', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    await store.unpublish(req.params.id)
    return { url: null }
  })

  // Публичная страница галереи: без авторизации, по непубличному токену.
  // Только чтение и только картинки; noindex, чтобы ссылку не съели роботы.
  app.get<{ Params: { token: string } }>('/g/:token/', async (req, reply) => {
    const conversationId = await store.publishedTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Галерея не найдена или снята')
    void store.countView(conversationId)
    const files = await store.list(conversationId)
    const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const cards = files.map((file) => `<figure><a href="file?path=${encodeURIComponent(file.path)}" target="_blank" rel="noopener"><img loading="lazy" src="file?path=${encodeURIComponent(file.path)}" alt="${esc(file.path)}"></a><figcaption>${esc(file.path)}${file.prompt ? `<small>${esc(file.prompt)}</small>` : ''}</figcaption></figure>`).join('')
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Галерея</title><style>
      body{margin:0;padding:24px;font:14px/1.4 system-ui,sans-serif;background:#111;color:#eee}
      h1{font-size:18px;margin:0 0 16px}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
      figure{margin:0;background:#1c1c1c;border-radius:10px;padding:10px}
      img{width:100%;height:200px;object-fit:contain;background:#fff;border-radius:6px}
      figcaption{margin-top:8px;word-break:break-word}
      figcaption small{display:block;color:#999;margin-top:2px}
    </style></head><body><h1>Галерея · ${files.length} файл(ов)</h1><div class="grid">${cards}</div></body></html>`
    return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex').send(html)
  })

  app.get<{ Params: { token: string }; Querystring: { path?: string } }>('/g/:token/file', async (req, reply) => {
    const conversationId = await store.publishedTarget(req.params.token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Галерея не найдена или снята')
    try {
      const data = await store.readBuffer(conversationId, req.query.path ?? '')
      if (!data) return reply.code(404).send({ error: 'файл не найден' })
      return reply.header('content-type', imageStudioMime(req.query.path ?? '')).header('cache-control', 'no-store').send(data)
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string } }>('/api/image-studio/:id/cancel', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    const run = activeRuns.get(req.params.id)
    if (!run) return { cancelled: false }
    run.cancel()
    return { cancelled: true }
  })
}
