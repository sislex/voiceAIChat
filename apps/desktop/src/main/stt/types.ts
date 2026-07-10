// Абстракция STT-движка (Шаг 7). Позволяет мокать распознавание в тестах и
// подменять реализацию (nodejs-whisper сейчас, потенциально другое — позже).

/** Один сегмент распознанной речи. speakerId=1 до появления диаризации (Шаг 10). */
export interface SttSegment {
  speakerId: number
  text: string
  /** Таймкоды в секундах от начала записи (если движок их даёт). */
  start?: number
  end?: number
}

/** Результат распознавания буфера аудио. */
export interface SttResult {
  segments: SttSegment[]
  /** Полный текст (сегменты, склеенные пробелом). */
  text: string
  /** true — финальный результат по завершению записи; false — частичная гипотеза. */
  isFinal: boolean
}

export interface TranscribeOptions {
  /** Язык распознавания (ISO-639-1), напр. 'ru'. */
  language: string
  /** Финальный прогон (влияет на пометку результата и, возможно, на параметры). */
  final?: boolean
}

/**
 * Движок распознавания речи. Работает с буфером PCM Int16 mono.
 * Реализация сама решает, как исполнять (файл + бинарь, аддон и т.п.).
 */
export interface SttEngine {
  /** Готов ли движок: модель на месте и бинарь доступен. */
  isReady(): Promise<boolean>
  /** Распознать буфер PCM Int16 mono с заданной частотой. */
  transcribe(
    pcm: Int16Array,
    sampleRate: number,
    opts: TranscribeOptions
  ): Promise<SttResult>
}
