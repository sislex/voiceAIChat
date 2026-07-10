// Скачивание GGML-модели Whisper с прогрессом (Шаг 9).
// Тянет .bin напрямую с HuggingFace (тот же источник, что и download-ggml-model.sh),
// стримит в файл и репортит проценты. Сборка whisper.cpp — отдельный шаг настройки.

import { createWriteStream, mkdirSync } from 'node:fs'
import { rm, rename } from 'node:fs/promises'
import type { WhisperModel } from '@voicechat/shared'
import { modelFileName, modelPath } from './models'

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

/** URL GGML-файла модели на HuggingFace. */
export function modelUrl(model: WhisperModel): string {
  return `${HF_BASE}/${modelFileName(model)}`
}

/** Процент загрузки (0–100). При неизвестном total возвращает 0. */
export function progressPercent(received: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((received / total) * 100))
}

type FetchLike = (url: string) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body: ReadableStream<Uint8Array> | null
}>

/**
 * Скачивает модель в `modelsDir`, вызывая onProgress по мере загрузки.
 * При ошибке удаляет частично скачанный файл. fetch инжектируется для тестов.
 */
export async function downloadModel(
  model: WhisperModel,
  modelsDir: string,
  onProgress: (percent: number) => void,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<void> {
  const dest = modelPath(modelsDir, model)
  // Пишем во временный .part и переименовываем по завершении: частичная/оборванная
  // загрузка никогда не появляется под финальным именем (иначе isModelPresent примет
  // её за готовую модель, и Whisper упадёт при загрузке).
  const part = `${dest}.part`
  const res = await fetchImpl(modelUrl(model))
  if (!res.ok || !res.body) {
    throw new Error(`Не удалось скачать модель: HTTP ${res.status}`)
  }

  const total = Number(res.headers.get('content-length')) || 0
  mkdirSync(modelsDir, { recursive: true }) // иначе open(.part) → ENOENT
  const out = createWriteStream(part)
  let received = 0
  let lastPercent = -1

  // Ошибку потока (нет места/прав и т.п.) превращаем в reject, а не в
  // необработанное событие 'error' (иначе падает весь процесс сервера).
  const streamError = new Promise<never>((_, reject) => {
    out.on('error', reject)
  })

  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), streamError])
      if (done) break
      received += value.length
      out.write(Buffer.from(value))
      const percent = progressPercent(received, total)
      if (percent !== lastPercent) {
        lastPercent = percent
        onProgress(percent)
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject)
      out.end(() => resolve())
    })
    await rename(part, dest) // атомарная публикация готового файла
    onProgress(100)
  } catch (err) {
    out.destroy()
    await rm(part, { force: true }).catch(() => {})
    throw err
  }
}
