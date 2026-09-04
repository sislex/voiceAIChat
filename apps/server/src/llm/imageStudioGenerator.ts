// Генерация и правка изображения для студии картинок: один ход LLM с
// приложенными исходниками, модель РИСУЕТ инструментами (скриптом в sandbox
// workspace-write — без права исполнения CLI не способен создать PNG) и
// показывает результат штатным fenced-блоком image; сервер читает файл.
import type { LlmClient } from '../claude/types.js'
import { IMAGE_HINT, parseImages, type LlmAttachment } from '@voicechat/shared'

export interface ImageStudioGenerator {
  (input: { prompt: string; source?: Buffer; sourceName?: string; references?: Array<{ name: string; data: Buffer }>; onCancel?: (cancel: () => void) => void }): Promise<Buffer>
}

export function llmImageStudioGenerator(opts: {
  client: LlmClient
  userId: string
  model: string
  /** Желаемая рабочая директория рана; исполнитель сам решает, можно ли в неё перейти. */
  cwd?: string
  readGenerated(path: string): Promise<{ dataBase64: string } | null>
}): ImageStudioGenerator {
  return async ({ prompt, source, sourceName, references, onCancel }) => {
    const attachments: LlmAttachment[] = [
      ...(source ? [{ serverPath: `/studio/${sourceName ?? 'source.png'}`, runnerName: sourceName ?? 'source.png', dataBase64: source.toString('base64') }] : []),
      ...(references ?? []).map((ref, index) => ({ serverPath: `/studio/reference-${index + 1}-${ref.name}`, runnerName: `reference-${index + 1}-${ref.name}`, dataBase64: ref.data.toString('base64') }))
    ]
    const lines = source
      ? [
          `Отредактируй приложенное изображение ${sourceName ?? 'source.png'} строго по промпту ниже, сохранив его размер и общий стиль, если промпт не требует иного.`,
          'Правь картинку скриптом (например, Python/Pillow или ImageMagick) — сгенерируй и выполни его.',
          'Сохрани результат отдельным PNG в текущей директории и обязательно укажи его абсолютный путь через штатный fenced-блок image.',
          `Промпт пользователя: ${prompt}`,
          IMAGE_HINT
        ]
      : [
          'Нарисуй изображение строго по промпту ниже: напиши и выполни скрипт (например, Python/Pillow или ImageMagick), который его отрисует.',
          ...(references?.length ? ['Приложенные файлы reference-*.png — визуальные референсы: повтори их стиль, палитру и настроение, не копируя композицию буквально.'] : []),
          'Сохрани результат отдельным PNG в текущей директории и обязательно укажи его абсолютный путь через штатный fenced-блок image.',
          `Промпт пользователя: ${prompt}`,
          IMAGE_HINT
        ]
    const fullText = await new Promise<string>((resolve, reject) => {
      const handle = opts.client.send({
        userId: opts.userId,
        prompt: lines.join('\n'),
        sessionId: null,
        model: opts.model,
        // Рисование требует инструментов; пишем только в workspace (cwd).
        permissionMode: 'acceptEdits',
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(attachments.length ? { attachments } : {})
      }, { onDelta: () => {}, onSession: () => {}, onDone: resolve, onError: reject })
      // cancel() у CLI-клиентов молчит (finished=true глушит onDone/onError),
      // поэтому промис реджектим сами — иначе ран отмены не дождётся никогда.
      onCancel?.(() => { handle.cancel(); reject(new Error('Генерация отменена')) })
    })
    const image = parseImages(fullText).images[0]
    if (!image) {
      // Без сниппета ответа причина «модель не нарисовала» недиагностируема:
      // в проде это единственный след того, что модель ответила на самом деле.
      console.warn(`[image-studio] ответ без image-блока: ${fullText.slice(0, 500)}`)
      throw new Error('AI не вернул файл изображения')
    }
    const file = await opts.readGenerated(image.path)
    if (!file?.dataBase64) throw new Error('Файл результата AI не найден')
    return Buffer.from(file.dataBase64, 'base64')
  }
}
