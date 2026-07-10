// Заглушка диаризации (Шаг 10): всё относит к одному спикеру (speakerId = 1).
// Чистый интерфейс готов к замене на реальную sherpa-onnx реализацию.

import type { SttSegment } from '@voicechat/shared'
import type { DiarizationEngine, DiarizeOptions } from './types'

export class StubDiarizationEngine implements DiarizationEngine {
  async diarize(
    _pcm: Int16Array,
    _sampleRate: number,
    segments: SttSegment[],
    _opts: DiarizeOptions
  ): Promise<SttSegment[]> {
    // Один говорящий: копируем сегменты, проставляя speakerId = 1.
    return segments.map((s) => ({ ...s, speakerId: 1 }))
  }
}
