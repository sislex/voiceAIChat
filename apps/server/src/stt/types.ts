// Абстракция STT-движка на сервере. Результаты — из общего пакета.

import type { SttResult } from '@voicechat/shared'

export interface TranscribeOptions {
  language: string
  final?: boolean
}

export interface SttEngine {
  isReady(): Promise<boolean>
  transcribe(pcm: Int16Array, sampleRate: number, opts: TranscribeOptions): Promise<SttResult>
}
