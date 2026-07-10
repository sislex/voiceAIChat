// Голоса Piper: id голоса = имя .onnx без расширения (напр. 'ru_RU-irina-medium').

import type { TtsVoiceInfo } from '@voicechat/shared'

const DEFAULT_VOICE = 'ru_RU-ruslan-medium'

const LANG_NAMES: Record<string, string> = {
  ru: 'русский',
  en: 'English',
  de: 'Deutsch',
  fr: 'français',
  es: 'español'
}

/** Имя .onnx-файла для id голоса (пустой id → голос по умолчанию). */
export function piperVoiceFile(voice: string): string {
  const id = voice && voice.trim() ? voice : DEFAULT_VOICE
  return id.endsWith('.onnx') ? id : `${id}.onnx`
}

/**
 * Человекочитаемое название из id вида `ru_RU-irina-medium`:
 * «Irina — русский (medium)». Неизвестный формат — сам id.
 */
export function piperVoiceLabel(id: string): string {
  const m = /^([a-z]{2})_[A-Z]{2}-(.+)-(low|medium|high|x_low)$/.exec(id)
  if (!m) return id
  const [, lang, name, quality] = m
  const langName = LANG_NAMES[lang] ?? lang
  const displayName = name.charAt(0).toUpperCase() + name.slice(1)
  return `${displayName} — ${langName} (${quality})`
}

/** Собирает список голосов из имён .onnx-файлов каталога. */
export function piperVoicesFromFiles(files: string[]): TtsVoiceInfo[] {
  return files
    .filter((f) => f.endsWith('.onnx'))
    .map((f) => f.slice(0, -'.onnx'.length))
    .map((id) => ({ id, label: piperVoiceLabel(id) }))
}
