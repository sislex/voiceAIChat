import type { LlmClient } from '../claude/types.js'
import { parseImages, type LlmAttachment } from '@voicechat/shared'
import type { RetouchGenerator } from '../imageRetouch.js'

export function llmRetouchGenerator(opts: {
  client: LlmClient
  userId: string
  model: string
  readGenerated(path: string): Promise<{ dataBase64: string } | null>
}): RetouchGenerator {
  return async ({ crop, mask, prompt, references, width, height }) => {
    const attachments: LlmAttachment[] = [
      { serverPath: '/retouch/crop.png', runnerName: 'crop.png', dataBase64: crop.toString('base64') },
      { serverPath: '/retouch/mask.png', runnerName: 'mask.png', dataBase64: mask.toString('base64') },
      ...references.map((data, index) => ({ serverPath: `/retouch/reference-${index + 1}.png`, runnerName: `reference-${index + 1}.png`, dataBase64: data.toString('base64') }))
    ]
    const fullText = await new Promise<string>((resolve, reject) => {
      opts.client.send({
        userId: opts.userId,
        prompt: [
          'Выполни локальную ретушь изображения crop.png строго по промпту ниже.',
          'mask.png: белые пиксели разрешено менять, чёрные должны служить контекстом и не являются частью визуального результата.',
          `Верни ровно один растровый файл размера ${width}×${height}; не рисуй маску, рамку или служебную заливку.`,
          'Используй изображения reference-*.png только как визуальные референсы, если они приложены.',
          'Сохрани результат отдельным PNG и обязательно укажи его через штатный fenced-блок image.',
          `Промпт пользователя: ${prompt}`
        ].join('\n'),
        sessionId: null,
        model: opts.model,
        executionDisabled: true,
        attachments
      }, {
        onDelta: () => {},
        onSession: () => {},
        onDone: resolve,
        onError: reject
      })
    })
    const image = parseImages(fullText).images[0]
    if (!image) throw new Error('AI не вернул файл изображения')
    const file = await opts.readGenerated(image.path)
    if (!file?.dataBase64) throw new Error('Файл результата AI не найден')
    return Buffer.from(file.dataBase64, 'base64')
  }
}
