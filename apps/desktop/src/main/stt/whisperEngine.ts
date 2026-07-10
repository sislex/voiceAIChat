// Реальный STT-движок на nodejs-whisper (whisper.cpp) — Шаг 7.
// PCM Int16 → валидный WAV (без ffmpeg) → whisper-cli → парсинг stdout в SttResult.

import { promises as fs, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodewhisper } from 'nodejs-whisper'
import type { WhisperModel } from '@shared/types'
import { buildResult } from './format'
import { isModelPresent } from './models'
import type { SttEngine, SttResult, TranscribeOptions } from './types'
import { encodeWav } from './wav'

export interface WhisperEngineOptions {
  /** Каталог с GGML-моделями (в dev — <project>/models). */
  modelsDir: string
  /** Текущая модель из настроек (читается на каждый прогон). */
  getModel: () => WhisperModel
}

let tempCounter = 0

export class WhisperEngine implements SttEngine {
  constructor(private readonly opts: WhisperEngineOptions) {}

  async isReady(): Promise<boolean> {
    return isModelPresent(this.opts.modelsDir, this.opts.getModel(), { existsSync, statSync })
  }

  async transcribe(
    pcm: Int16Array,
    sampleRate: number,
    opts: TranscribeOptions
  ): Promise<SttResult> {
    const model = this.opts.getModel()
    const wavPath = join(tmpdir(), `voicechat-stt-${process.pid}-${tempCounter++}.wav`)
    await fs.writeFile(wavPath, encodeWav(pcm, sampleRate))
    try {
      const stdout = await nodewhisper(wavPath, {
        modelName: model,
        modelRootPath: this.opts.modelsDir,
        removeWavFileAfterTranscription: false,
        whisperOptions: { language: opts.language }
      })
      return buildResult(stdout, opts.final ?? false)
    } finally {
      await fs.rm(wavPath, { force: true }).catch(() => {})
    }
  }
}
