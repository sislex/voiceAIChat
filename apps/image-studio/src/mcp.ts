import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import sharp from 'sharp'
import {
  IMAGE_STUDIO_MCP_PATH,
  imageStudioMime,
  isImageStudioConversation,
  type ImageStudioSelection
} from '@voicechat/shared'
import type { ImageStudioCore, ImageStudioGenerator } from './core.js'
import type { ImageStudioStore } from './studio.js'
import { detectImageStudioObjects, extractImageStudioSelection, magicWandImageStudioSelection, placeImageStudioObject, retouchImageStudioSelection } from './selection.js'

type TextResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
const text = (value: string, isError = false): TextResult => isError
  ? { content: [{ type: 'text', text: value }], isError: true }
  : { content: [{ type: 'text', text: value }] }

const rectangle = z.object({ kind: z.literal('rectangle'), x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() })
const lasso = z.object({ kind: z.literal('lasso'), points: z.array(z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() })).min(3).max(500) })
const wand = z.object({ kind: z.literal('wand'), x: z.number().nonnegative(), y: z.number().nonnegative(), tolerance: z.number().int().min(1).max(255).optional() })
const selectionSchema = z.union([rectangle, lasso, wand])

function derivedBase(path: string, suffix: string): string {
  const dot = path.lastIndexOf('.')
  return `${dot > 0 ? path.slice(0, dot) : path}-${suffix}.png`
}

export function registerImageStudioMcp(app: FastifyInstance, deps: {
  store: ImageStudioStore
  core: Pick<ImageStudioCore, 'conversation'>
  generator: (userId: string) => Promise<ImageStudioGenerator>
}, secret: string): void {
  const active = new Set<string>()
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_request, _payload, done) => done(null, undefined))
    scope.post<{ Querystring: { conv?: string; user?: string; k?: string; ro?: string } }>(IMAGE_STUDIO_MCP_PATH, async (request, reply) => {
      if (!secret || request.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
      const conversationId = request.query.conv ?? ''
      const userId = request.query.user ?? ''
      const conversation = await deps.core.conversation(userId, conversationId)
      if (!conversation || !isImageStudioConversation(conversation)) return reply.code(404).send({ error: 'conversation not found' })
      const readOnly = request.query.ro === '1'
      const server = new McpServer({ name: 'image_studio', version: '1.0.0' })
      const blocked = (): TextResult => text('Отклонено: режим «План» разрешает только image_list, image_open и image_find_objects.', true)
      const describe = (error: unknown): TextResult => text(error instanceof Error ? error.message : String(error), true)
      const modelRun = async <T>(operation: (generator: ImageStudioGenerator) => Promise<T>): Promise<T> => {
        if (active.has(conversationId)) throw new Error('В этой студии уже идёт генерация или ретушь')
        active.add(conversationId)
        try { return await operation(await deps.generator(userId)) } finally { active.delete(conversationId) }
      }
      const resolveSelection = async (source: Buffer, selection: z.infer<typeof selectionSchema>): Promise<ImageStudioSelection> => selection.kind === 'wand'
        ? magicWandImageStudioSelection(source, selection.x, selection.y, selection.tolerance)
        : selection

      server.registerTool('image_list', {
        description: 'Список всех изображений студии с операцией, исходником и историей. Начинай работу с этого инструмента.',
        inputSchema: {}
      }, async () => {
        try { return text(JSON.stringify(await deps.store.list(conversationId), null, 2)) } catch (error) { return describe(error) }
      })

      server.registerTool('image_open', {
        description: 'Открыть изображение модели и прочитать его метаданные. Используй перед любой правкой или выделением.',
        inputSchema: { path: z.string() }
      }, async ({ path }) => {
        try {
          const data = await deps.store.readBuffer(conversationId, path)
          if (!data) return text(`Файл «${path}» не найден`, true)
          const file = (await deps.store.list(conversationId)).find((item) => item.path === path)
          const originalMime = imageStudioMime(path)
          const supported = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(originalMime)
          const image = supported ? data : await sharp(data).png().toBuffer()
          return { content: [
            { type: 'text' as const, text: JSON.stringify(file ?? { path }, null, 2) },
            { type: 'image' as const, data: image.toString('base64'), mimeType: supported ? originalMime : 'image/png' }
          ] }
        } catch (error) { return describe(error) }
      })

      server.registerTool('image_find_objects', {
        description: 'Найти крупные объекты и людей на простом фоне. Возвращает прямоугольники в пикселях исходного изображения; для сложной сцены используй image_open и выделение wand или lasso.',
        inputSchema: { path: z.string(), tolerance: z.number().int().min(1).max(255).optional() }
      }, async ({ path, tolerance }) => {
        try {
          const source = await deps.store.readBuffer(conversationId, path)
          if (!source) return text(`Файл «${path}» не найден`, true)
          return text(JSON.stringify(await detectImageStudioObjects(source, tolerance), null, 2))
        } catch (error) { return describe(error) }
      })

      server.registerTool('image_generate', {
        description: 'Создать новое изображение по промпту. Результат автоматически становится первой версией новой ветки.',
        inputSchema: { prompt: z.string().min(1).max(4000), name: z.string().optional(), references: z.array(z.string()).max(4).optional() }
      }, async ({ prompt, name, references }) => {
        if (readOnly) return blocked()
        try {
          const referenceFiles: Array<{ name: string; data: Buffer }> = []
          for (const path of references ?? []) {
            const data = await deps.store.readBuffer(conversationId, path)
            if (!data) return text(`Референс «${path}» не найден`, true)
            referenceFiles.push({ name: path, data })
          }
          const data = await modelRun((generator) => generator({ prompt, references: referenceFiles }))
          const path = await deps.store.freeName(conversationId, name?.trim() || 'изображение.png')
          const file = await deps.store.writeBuffer(conversationId, path, data)
          await deps.store.setMeta(conversationId, path, { prompt, operation: 'generate' })
          return text(`Создано: ${file.path}`)
        } catch (error) { return describe(error) }
      })

      server.registerTool('image_edit', {
        description: 'Изменить всё изображение по промпту. Исходник сохраняется, результат записывается новой версией.',
        inputSchema: { path: z.string(), prompt: z.string().min(1).max(4000) }
      }, async ({ path, prompt }) => {
        if (readOnly) return blocked()
        try {
          const source = await deps.store.readBuffer(conversationId, path)
          if (!source) return text(`Файл «${path}» не найден`, true)
          const data = await modelRun((generator) => generator({ prompt, source, sourceName: path }))
          const target = await deps.store.freeName(conversationId, path)
          await deps.store.writeBuffer(conversationId, target, data)
          await deps.store.setMeta(conversationId, target, { prompt, source: path, operation: 'edit' })
          return text(`Новая версия: ${target}. Исходник ${path} сохранён.`)
        } catch (error) { return describe(error) }
      })

      server.registerTool('image_retouch', {
        description: 'Безопасно изменить только прямоугольник или лассо. Пиксели вне выделения копируются из исходника и не меняются.',
        inputSchema: { path: z.string(), prompt: z.string().min(1).max(4000), selection: selectionSchema, references: z.array(z.string()).max(4).optional() }
      }, async ({ path, prompt, selection, references }) => {
        if (readOnly) return blocked()
        try {
          const original = await deps.store.readBuffer(conversationId, path)
          if (!original) return text(`Файл «${path}» не найден`, true)
          const referenceData: Buffer[] = []
          for (const reference of references ?? []) {
            const data = await deps.store.readBuffer(conversationId, reference)
            if (!data) return text(`Референс «${reference}» не найден`, true)
            referenceData.push(data)
          }
          const resolvedSelection = await resolveSelection(original, selection)
          const result = await modelRun(async (generator) => retouchImageStudioSelection({
            original, selection: resolvedSelection, prompt, references: referenceData,
            generate: ({ crop, mask, width, height, references: refs }) => generator({
              prompt, source: crop, sourceName: 'selection.png', mask, targetSize: { width, height },
              references: refs.map((data, index) => ({ name: `reference-${index + 1}.png`, data }))
            })
          }))
          const target = await deps.store.freeName(conversationId, derivedBase(path, 'ретушь'))
          await deps.store.writeBuffer(conversationId, target, result.image)
          await deps.store.setMeta(conversationId, target, { prompt, source: path, operation: 'retouch', selection: result.bounds })
          return text(`Ретушь сохранена: ${target}. Вне выделения исходные пиксели сохранены.`)
        } catch (error) { return describe(error) }
      })

      server.registerTool('image_extract', {
        description: 'Извлечь прямоугольник или лассо в отдельный прозрачный PNG для независимой правки.',
        inputSchema: { path: z.string(), selection: selectionSchema }
      }, async ({ path, selection }) => {
        if (readOnly) return blocked()
        try {
          const original = await deps.store.readBuffer(conversationId, path)
          if (!original) return text(`Файл «${path}» не найден`, true)
          const result = await extractImageStudioSelection(original, await resolveSelection(original, selection))
          const target = await deps.store.freeName(conversationId, derivedBase(path, 'объект'))
          await deps.store.writeBuffer(conversationId, target, result.image)
          await deps.store.setMeta(conversationId, target, { source: path, operation: 'extract', selection: result.bounds })
          return text(`Объект сохранён: ${target}. Позиция ${result.bounds.x},${result.bounds.y}; размер ${result.bounds.width}×${result.bounds.height}.`)
        } catch (error) { return describe(error) }
      })

      server.registerTool('image_place', {
        description: 'Вернуть извлечённый и при необходимости отредактированный объект на исходное изображение. Без координат используется исходная позиция.',
        inputSchema: { objectPath: z.string(), basePath: z.string().optional(), x: z.number().int().nonnegative().optional(), y: z.number().int().nonnegative().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() }
      }, async ({ objectPath, basePath, x, y, width, height }) => {
        if (readOnly) return blocked()
        try {
          const origin = await deps.store.extractionOrigin(conversationId, objectPath)
          const base = basePath ?? origin?.path
          if (!base) return text('Не найден исходник извлечённого объекта; укажите basePath', true)
          const baseData = await deps.store.readBuffer(conversationId, base)
          const objectData = await deps.store.readBuffer(conversationId, objectPath)
          if (!baseData || !objectData) return text('Исходник или объект не найден', true)
          const placed = await placeImageStudioObject({ base: baseData, object: objectData, x: x ?? origin?.bounds.x ?? 0, y: y ?? origin?.bounds.y ?? 0, width: width ?? origin?.bounds.width, height: height ?? origin?.bounds.height })
          const target = await deps.store.freeName(conversationId, derivedBase(base, 'с-объектом'))
          await deps.store.writeBuffer(conversationId, target, placed)
          await deps.store.setMeta(conversationId, target, { source: base, operation: 'place', selection: { kind: 'rectangle', x: x ?? origin?.bounds.x ?? 0, y: y ?? origin?.bounds.y ?? 0, width: width ?? origin?.bounds.width ?? 1, height: height ?? origin?.bounds.height ?? 1 } })
          return text(`Объект ${objectPath} возвращён: ${target}.`)
        } catch (error) { return describe(error) }
      })

      server.registerTool('image_restore', {
        description: 'Откатить текущую ветку к исторической версии без удаления последующих версий.',
        inputSchema: { currentPath: z.string(), targetPath: z.string() }
      }, async ({ currentPath, targetPath }) => {
        if (readOnly) return blocked()
        try {
          if (!await deps.store.readBuffer(conversationId, currentPath)) return text(`Текущая версия «${currentPath}» не найдена`, true)
          const targetData = await deps.store.readBuffer(conversationId, targetPath)
          if (!targetData) return text(`Историческая версия «${targetPath}» не найдена`, true)
          const path = await deps.store.freeName(conversationId, derivedBase(currentPath, 'восстановлено'))
          await deps.store.writeBuffer(conversationId, path, targetData)
          await deps.store.setMeta(conversationId, path, { source: currentPath, operation: 'restore', restoredFrom: targetPath })
          return text(`Восстановлено в новую версию ${path}; ${currentPath} и ${targetPath} сохранены.`)
        } catch (error) { return describe(error) }
      })

      server.registerTool('image_rename', {
        description: 'Переименовать изображение; связи истории обновляются автоматически.',
        inputSchema: { from: z.string(), to: z.string() }
      }, async ({ from, to }) => {
        if (readOnly) return blocked()
        try { await deps.store.rename(conversationId, from, to); return text(`Переименовано: ${from} → ${to}`) } catch (error) { return describe(error) }
      })

      server.registerTool('image_delete', {
        description: 'Переместить изображение в корзину на семь дней.',
        inputSchema: { path: z.string() }
      }, async ({ path }) => {
        if (readOnly) return blocked()
        try { await deps.store.delete(conversationId, path); return text(`Перемещено в корзину: ${path}`) } catch (error) { return describe(error) }
      })

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      reply.raw.on('close', () => { void transport.close(); void server.close() })
      await server.connect(transport)
      await transport.handleRequest(request.raw, reply.raw, request.body)
    })
  })
}

export { IMAGE_STUDIO_MCP_PATH }
