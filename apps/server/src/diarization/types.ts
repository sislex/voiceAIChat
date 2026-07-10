// Абстракция диаризации (Шаг 10). Заглушка сейчас; на следующем этапе — sherpa-onnx
// (сегментация + speaker embeddings + кластеризация, до 4 спикеров).

import type { SttSegment } from '@voicechat/shared'

export interface DiarizeOptions {
  /** Максимум спикеров для кластеризации (v1: до 4). */
  maxSpeakers: number
}

/**
 * Движок диаризации: по аудио и сегментам речи расставляет `speakerId`.
 * Работает поверх результата Whisper (сегменты с таймкодами).
 */
export interface DiarizationEngine {
  /**
   * Назначает сегментам `speakerId` на основе аудио. Не мутирует вход —
   * возвращает новый массив сегментов той же длины и порядка.
   */
  diarize(
    pcm: Int16Array,
    sampleRate: number,
    segments: SttSegment[],
    opts: DiarizeOptions
  ): Promise<SttSegment[]>
}
