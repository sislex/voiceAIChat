// Роуты студии картинок: галерея разговора вида images, загрузка, чтение,
// переименование, удаление и два действия модели — «нарисовать по промпту» и
// «поправить выбранную по промпту». Доступ — владелец разговора; чужой и
// несуществующий неотличимы (404), как везде в Make/чатах.
import type { FastifyInstance, FastifyReply } from 'fastify'
import { imageStudioMime, isImageStudioConversation } from '@voicechat/shared'
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
    if (!deps.generator) return reply.code(503).send({ error: 'Генерация изображений недоступна в этой конфигурации' })
    try {
      const data = await deps.generator(userId)({ prompt })
      const name = await store.freeName(req.params.id, (req.body?.name ?? '').trim() || 'изображение.png')
      const file = await store.writeBuffer(req.params.id, name, data)
      return { file, files: await store.list(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { path?: string; prompt?: string } }>('/api/image-studio/:id/edit', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const prompt = (req.body?.prompt ?? '').trim()
    if (!prompt) return reply.code(400).send({ error: 'Опишите, что изменить' })
    if (!deps.generator) return reply.code(503).send({ error: 'Правка изображений недоступна в этой конфигурации' })
    try {
      const source = await store.readBuffer(req.params.id, req.body?.path ?? '')
      if (!source) return reply.code(404).send({ error: 'файл не найден' })
      const data = await deps.generator(userId)({ prompt, source, sourceName: req.body?.path ?? 'source.png' })
      // Правка не затирает оригинал: результат — новый файл рядом. Откат — это
      // просто удаление новой версии, истории снимков студии не нужно.
      const name = await store.freeName(req.params.id, req.body?.path ?? 'правка.png')
      const file = await store.writeBuffer(req.params.id, name, data)
      return { file, files: await store.list(req.params.id) }
    } catch (error) { return sendStudioError(reply, error) }
  })
}
