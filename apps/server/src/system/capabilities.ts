// Вычисление возможностей системы (STT/TTS) из ресурсов контейнера и порогов
// памяти. Whisper (STT) прожорлив и зависит от модели; Piper (TTS) лёгкий.
// Если памяти меньше нужного — функция помечается недоступной с причиной для UI,
// а сервер жёстко блокирует соответствующие WS-команды.

import type { SystemCapabilities, WhisperModel } from '@voicechat/shared'
import type { SystemResources } from './resources.js'

const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024

/** Пороги памяти (байты): для STT — по модели Whisper, для TTS — единый. */
export interface MemThresholds {
  sttByModel: Record<WhisperModel, number>
  tts: number
}

/**
 * Дефолтные пороги. Оценки пикового потребления процессом распознавания/озвучки
 * с запасом на ОС и остальной сервер (не только вес модели на диске).
 */
export const DEFAULT_MEM_THRESHOLDS: MemThresholds = {
  sttByModel: {
    'large-v3-turbo': 2 * GB,
    medium: Math.round(1.2 * GB),
    small: Math.round(0.6 * GB)
  },
  tts: Math.round(0.4 * GB)
}

/** Ручные переопределения порогов из конфига (env). Байты; undefined — брать дефолт. */
export interface MemOverrides {
  stt?: number
  tts?: number
}

/** Человекочитаемый размер (ГБ/МБ) для причины в UI. */
function fmt(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} ГБ` : `${Math.round(bytes / MB)} МБ`
}

/**
 * Считает возможности из ресурсов, выбранной модели Whisper и порогов.
 * @param model выбранная модель Whisper (влияет на порог STT)
 */
export function computeCapabilities(
  resources: SystemResources,
  model: WhisperModel,
  thresholds: MemThresholds = DEFAULT_MEM_THRESHOLDS,
  overrides: MemOverrides = {}
): SystemCapabilities {
  const limit = resources.memoryLimitBytes
  const sttNeed = overrides.stt ?? thresholds.sttByModel[model]
  const ttsNeed = overrides.tts ?? thresholds.tts

  const sttOk = limit >= sttNeed
  const ttsOk = limit >= ttsNeed

  return {
    memoryLimitBytes: limit,
    cpuCount: resources.cpuCount,
    stt: {
      available: sttOk,
      reason: sttOk
        ? ''
        : `Недостаточно памяти в контейнере: ${fmt(limit)} (для распознавания речи нужно ~${fmt(sttNeed)})`
    },
    tts: {
      available: ttsOk,
      reason: ttsOk
        ? ''
        : `Недостаточно памяти в контейнере: ${fmt(limit)} (для озвучки нужно ~${fmt(ttsNeed)})`
    }
  }
}
