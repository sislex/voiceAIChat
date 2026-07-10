// Каталог скачиваемых русских голосов Piper (rhasspy/piper-voices на HuggingFace).

import { piperVoiceLabel } from './piperVoices'

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

/** id голосов каталога (v1 — русские medium). */
export const PIPER_CATALOG_IDS = [
  'ru_RU-irina-medium',
  'ru_RU-dmitri-medium',
  'ru_RU-ruslan-medium',
  'ru_RU-denis-medium'
]

/** Человекочитаемый список каталога (id + метка). */
export function piperCatalog(): { id: string; label: string }[] {
  return PIPER_CATALOG_IDS.map((id) => ({ id, label: piperVoiceLabel(id) }))
}

/**
 * URL-ы файлов голоса на HuggingFace из id вида `ru_RU-irina-medium`:
 * `<base>/ru/ru_RU/irina/medium/<id>.onnx` (+ `.onnx.json`).
 */
export function voiceUrls(id: string): { onnx: string; config: string } | null {
  const m = /^(([a-z]{2})_[A-Z]{2})-(.+)-(low|medium|high|x_low)$/.exec(id)
  if (!m) return null
  const [, locale, lang, name, quality] = m
  const dir = `${HF_BASE}/${lang}/${locale}/${name}/${quality}`
  return { onnx: `${dir}/${id}.onnx`, config: `${dir}/${id}.onnx.json` }
}
