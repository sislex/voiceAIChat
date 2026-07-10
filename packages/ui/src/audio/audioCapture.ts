// Захват аудио с микрофона (Шаг 6): getUserMedia + AudioWorklet.
// Worklet присылает сырые Float32-фреймы; здесь мы ресемплим в 16 kHz, конвертируем
// в Int16 и нарезаем на чанки ~250 мс, отдавая их через onChunk.
//
// Требует Web Audio API, поэтому не юнит-тестируется (jsdom его не предоставляет);
// вся детерминированная логика вынесена в pcm.ts и покрыта тестами.

import {
  CHUNK_MS,
  chunkSamplesForMs,
  floatTo16BitPCM,
  PcmChunker,
  resampleLinear,
  TARGET_SAMPLE_RATE
} from './pcm'

export interface AudioCaptureOptions {
  /** deviceId выбранного микрофона или null (устройство по умолчанию). */
  deviceId?: string | null
  /** URL модуля worklet (blob:-URL из PCM_WORKLET_SOURCE, см. browserAudio.ts). */
  workletUrl: string | URL
  /** Колбэк на каждый готовый чанк Int16 PCM mono. */
  onChunk: (chunk: Int16Array, sampleRate: number) => void
  /** Целевая частота (по умолчанию 16 kHz). */
  targetSampleRate?: number
  /** Длительность чанка в мс (по умолчанию 250). */
  chunkMs?: number
}

export class AudioCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private readonly chunker: PcmChunker
  private readonly targetRate: number
  private running = false

  constructor(private readonly opts: AudioCaptureOptions) {
    this.targetRate = opts.targetSampleRate ?? TARGET_SAMPLE_RATE
    this.chunker = new PcmChunker(chunkSamplesForMs(opts.chunkMs ?? CHUNK_MS, this.targetRate))
  }

  get sampleRate(): number {
    return this.targetRate
  }

  async start(): Promise<void> {
    if (this.running) return
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia недоступен в этом окружении')
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.opts.deviceId ? { exact: this.opts.deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    // Просим контекст сразу на целевой частоте — тогда ресемпл фактически no-op.
    this.ctx = new AudioContext({ sampleRate: this.targetRate })
    await this.ctx.audioWorklet.addModule(this.opts.workletUrl)

    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'pcm-forward')
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.handleFrame(e.data)

    this.source.connect(this.node)
    // Узел ничего не пишет в выход (тишина), но подключение к destination «протягивает» граф.
    this.node.connect(this.ctx.destination)
    this.running = true
  }

  private handleFrame(frame: Float32Array): void {
    if (!this.running || !this.ctx) return
    const resampled = resampleLinear(frame, this.ctx.sampleRate, this.targetRate)
    const pcm = floatTo16BitPCM(resampled)
    for (const chunk of this.chunker.push(pcm)) {
      this.opts.onChunk(chunk, this.targetRate)
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    // Отдаём накопленный хвост перед закрытием.
    const tail = this.chunker.flush()
    if (tail) this.opts.onChunk(tail, this.targetRate)

    if (this.node) {
      this.node.port.onmessage = null
      this.node.disconnect()
      this.node = null
    }
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.ctx) {
      await this.ctx.close()
      this.ctx = null
    }
  }
}
