// Генерация и правка изображения для студии картинок: один ход LLM с
// приложенными исходниками, модель РИСУЕТ инструментами (скриптом в sandbox
// workspace-write — без права исполнения CLI не способен создать PNG) и
// показывает результат штатным fenced-блоком image; сервер читает файл.
import type { LlmClient } from '../claude/types.js'
import { IMAGE_HINT, parseImages, type LlmAttachment } from '@voicechat/shared'

import type { ImageStudioGenerator } from '@voicechat/image-studio'

export function llmImageStudioGenerator(opts: {
  client: LlmClient
  userId: string
  model: string
  /** Желаемая рабочая директория рана; исполнитель сам решает, можно ли в неё перейти. */
  cwd?: string
  readGenerated(path: string): Promise<{ dataBase64: string } | null>
}): ImageStudioGenerator {
  return async ({ prompt, source, sourceName, mask, targetSize, references, onCancel }) => {
    const sourcePath = `/studio/${sourceName ?? 'source.png'}`
    const maskPath = '/studio/mask.png'
    const referencePaths = (references ?? []).map((ref, index) => `/studio/reference-${index + 1}-${ref.name}`)
    const attachments: LlmAttachment[] = [
      ...(source ? [{ serverPath: sourcePath, runnerName: sourceName ?? 'source.png', dataBase64: source.toString('base64') }] : []),
      ...(mask ? [{ serverPath: maskPath, runnerName: 'mask.png', dataBase64: mask.toString('base64') }] : []),
      ...(references ?? []).map((ref, index) => ({ serverPath: referencePaths[index]!, runnerName: `reference-${index + 1}-${ref.name}`, dataBase64: ref.data.toString('base64') }))
    ]
    const lines = source && mask && targetSize
      ? [
          `Retouch the attached ${sourcePath} strictly according to the user prompt below.`,
          `${maskPath} marks editable pixels in white; black pixels are context and must remain visually compatible.`,
          `Return exactly one raster image sized ${targetSize.width}×${targetSize.height}. Do not draw the mask, guides, or a service background.`,
          ...(referencePaths.length ? [`Use ${referencePaths.join(', ')} only as visual references.`] : []),
          'Save the result as a separate PNG and expose its absolute path through the standard fenced image block.',
          `User prompt: ${prompt}`,
          IMAGE_HINT
        ]
      : source
      ? [
          `Отредактируй приложенное изображение ${sourcePath} строго по промпту ниже, сохранив его размер и общий стиль, если промпт не требует иного.`,
          'Правь картинку скриптом (например, Python/Pillow или ImageMagick) — сгенерируй и выполни его.',
          'Сохрани результат отдельным PNG в текущей директории и обязательно укажи его абсолютный путь через штатный fenced-блок image.',
          `Промпт пользователя: ${prompt}`,
          IMAGE_HINT
        ]
      : [
          'Нарисуй изображение строго по промпту ниже: напиши и выполни скрипт (например, Python/Pillow или ImageMagick), который его отрисует.',
          ...(referencePaths.length ? [`Приложенные файлы ${referencePaths.join(', ')} — визуальные референсы: повтори их стиль, палитру и настроение, не копируя композицию буквально.`] : []),
          'Сохрани результат отдельным PNG в текущей директории и обязательно укажи его абсолютный путь через штатный fenced-блок image.',
          `Промпт пользователя: ${prompt}`,
          IMAGE_HINT
        ]
    const fullText = await new Promise<string>((resolve, reject) => {
      let handle: { cancel(): void } | undefined
      let cancelled = false
      // Регистрируем отмену до асинхронного соединения с исполнителем.
      onCancel?.(() => { cancelled = true; handle?.cancel(); reject(new Error('Генерация отменена')) })
      if (cancelled) return
      void Promise.resolve().then(() => opts.client.send({
        userId: opts.userId,
        prompt: lines.join('\n'),
        sessionId: null,
        model: opts.model,
        // Рисование требует инструментов; пишем только в workspace (cwd).
        permissionMode: 'acceptEdits',
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(attachments.length ? { attachments } : {})
      }, { onDelta: async () => {}, onSession: async () => {}, onDone: resolve, onError: reject })).then((started) => {
        handle = started
        if (cancelled) handle.cancel()
      }, reject)
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
