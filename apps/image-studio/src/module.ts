import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { isImageStudioConversation, parseImages } from '@voicechat/shared'
import type { ImageStudioCore } from './core.js'
import type { ImageStudioService } from './service.js'
import { ImageStudioStore } from './studio.js'
import { registerImageStudioRoutes } from './routes.js'
import { registerImageStudioMcp } from './mcp.js'

export function createImageStudioModule(opts: { dataDir: string; core: ImageStudioCore; mcpSecret: string }) {
  const { core } = opts
  // Каталог тот же, что до выделения: существующие галереи не требуют миграции.
  const store = new ImageStudioStore(join(opts.dataDir, 'image-studio'))
  const service: ImageStudioService = {
    async promptContext(conversationId) {
      const files = await store.list(conversationId)
      const listing = files.slice(0, 30).map((file) => `- ${file.path}${file.prompt ? ` (промпт: ${file.prompt.slice(0, 80)})` : ''}`).join('\n')
      return [
        '## Студия картинок',
        'Это чат студии картинок: пользователь собирает галерею изображений этого разговора.',
        'Когда рисуешь или правишь картинку — сохрани файл и обязательно покажи его штатным fenced-блоком image с абсолютным путём: только так он попадает в галерею.',
        listing ? `Сейчас в галерее:\n${listing}` : 'Галерея пока пуста.'
      ].join('\n')
    },
    async captureImages(userId, conversationId, finalText) {
      const conversation = await core.conversation(userId, conversationId)
      if (!conversation || !isImageStudioConversation(conversation)) return
      for (const image of parseImages(finalText).images.slice(0, 10)) {
        try {
          const file = await core.readGenerated(userId, image.path)
          if (!file?.dataBase64) continue
          const original = image.path.split('/').pop() ?? 'изображение.png'
          const readable = /^exec-[0-9a-f-]{20,}\./i.test(original) ? `из-чата${original.slice(original.lastIndexOf('.'))}` : original
          const name = await store.freeName(conversationId, readable)
          await store.writeBuffer(conversationId, name, Buffer.from(file.dataBase64, 'base64'))
          await store.setMeta(conversationId, name, { operation: 'generate' })
        } catch {
          // Не-картинка, квота или недоступный файл не должны ломать ход чата.
        }
      }
    }
  }
  return {
    store, service,
    register(app: FastifyInstance) {
      registerImageStudioMcp(app, { store, core, generator: async (userId) => (input) => core.generate(userId, input) }, opts.mcpSecret)
      registerImageStudioRoutes(app, { core, store, generator: async (userId) => (input) => core.generate(userId, input) })
    }
  }
}
