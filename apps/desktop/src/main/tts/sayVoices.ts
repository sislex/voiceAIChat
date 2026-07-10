// Голоса macOS `say`: id голоса = имя голоса (напр. 'Milena').

import type { TtsVoiceInfo } from '@shared/types'

const DEFAULT_VOICE = 'Milena'

const LANG_NAMES: Record<string, string> = {
  ru: 'русский',
  en: 'English',
  de: 'Deutsch',
  fr: 'français',
  es: 'español'
}

/** Имя голоса `say` для настройки (пустой → голос по умолчанию). */
export function sayVoiceName(voice: string): string {
  return voice && voice.trim() ? voice : DEFAULT_VOICE
}

/**
 * Парсит вывод `say -v '?'` в список голосов.
 * Формат строки: `Имя[  ...]  ll_CC    # пример`. Оставляем только голоса на
 * указанных языках (по умолчанию русский), с человекочитаемой меткой.
 */
export function parseSayVoices(stdout: string, langs: string[] = ['ru']): TtsVoiceInfo[] {
  const out: TtsVoiceInfo[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(.+?)\s{2,}([a-z]{2})_[A-Z]{2}\b/.exec(line)
    if (!m) continue
    const name = m[1].trim()
    const lang = m[2]
    if (langs.length > 0 && !langs.includes(lang)) continue
    const langName = LANG_NAMES[lang] ?? lang
    out.push({ id: name, label: `${name} — ${langName}` })
  }
  return out
}
