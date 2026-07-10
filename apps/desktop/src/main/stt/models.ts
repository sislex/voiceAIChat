// Менеджер моделей Whisper (Шаг 7): сопоставление имён, пути, проверка наличия.
// Реальное скачивание делегируется nodejs-whisper (autoDownloadModelName); здесь —
// детерминированная логика выбора/наличия, юнит-тестируемая на моке ФС.

import { join } from 'node:path'
import { WHISPER_MODELS, type WhisperModel, type WhisperModelInfo } from '@shared/types'

/** Имена GGML-файлов для поддерживаемых в v1 моделей (совпадают с nodejs-whisper). */
const MODEL_FILENAMES: Record<WhisperModel, string> = {
  'large-v3-turbo': 'ggml-large-v3-turbo.bin',
  medium: 'ggml-medium.bin',
  small: 'ggml-small.bin'
}

/** Имя GGML-файла модели. */
export function modelFileName(model: WhisperModel): string {
  return MODEL_FILENAMES[model]
}

/** Абсолютный путь к файлу модели внутри каталога моделей. */
export function modelPath(modelsDir: string, model: WhisperModel): string {
  return join(modelsDir, modelFileName(model))
}

/** Минимально допустимый размер файла модели (защита от «обрезанных» загрузок). */
const MIN_MODEL_BYTES = 1_000_000 // 1 МБ — реальные модели ≥ 400 МБ

/** Интерфейс ФС, достаточный для проверки наличия (упрощает мок в тестах). */
export interface StatFs {
  existsSync(path: string): boolean
  statSync(path: string): { size: number }
}

/**
 * Есть ли валидный файл модели: существует и не пустой/обрезанный.
 * По умолчанию использует node:fs, в тестах ФС инжектится.
 */
export function isModelPresent(
  modelsDir: string,
  model: WhisperModel,
  fs: StatFs
): boolean {
  const path = modelPath(modelsDir, model)
  if (!fs.existsSync(path)) return false
  try {
    return fs.statSync(path).size >= MIN_MODEL_BYTES
  } catch {
    return false
  }
}

/** Список всех моделей с наличием и размером файла (для управления местом). */
export function listModels(modelsDir: string, fs: StatFs): WhisperModelInfo[] {
  return WHISPER_MODELS.map((model) => {
    const present = isModelPresent(modelsDir, model, fs)
    let sizeBytes = 0
    if (present) {
      try {
        sizeBytes = fs.statSync(modelPath(modelsDir, model)).size
      } catch {
        sizeBytes = 0
      }
    }
    return { model, present, sizeBytes }
  })
}
