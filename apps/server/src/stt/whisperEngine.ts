// STT-движок сервера: спавнит whisper-cli (whisper.cpp) напрямую. Путь к бинарю и
// каталогу моделей — из конфигурации (можно указать на уже собранный whisper
// desktop-приложения, чтобы не дублировать сборку). PCM → WAV → whisper-cli → парсинг.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { promises as fs, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildResult } from '@voicechat/shared'
import type { WhisperModel } from '@voicechat/shared'
import { encodeWav } from './wav.js'
import { isModelPresent, modelPath } from './models.js'
import type { SttEngine, TranscribeOptions } from './types.js'

export type SpawnFn = (command: string, args: string[]) => ChildProcess

export interface WhisperEngineOptions {
  /** Путь к исполняемому whisper-cli. */
  whisperCli: string
  /** Каталог с GGML-моделями. */
  modelsDir: string
  /** Текущая модель из настроек. */
  getModel: () => WhisperModel
  spawn?: SpawnFn
}

let tempCounter = 0

export class WhisperEngine implements SttEngine {
  private readonly spawnFn: SpawnFn

  constructor(private readonly opts: WhisperEngineOptions) {
    this.spawnFn = opts.spawn ?? (nodeSpawn as unknown as SpawnFn)
  }

  async isReady(): Promise<boolean> {
    return existsSync(this.opts.whisperCli) && isModelPresent(this.opts.modelsDir, this.opts.getModel(), { existsSync, statSync })
  }

  async transcribe(pcm: Int16Array, sampleRate: number, opts: TranscribeOptions) {
    const model = this.opts.getModel()
    const wavPath = join(tmpdir(), `vc-server-stt-${process.pid}-${tempCounter++}.wav`)
    await fs.writeFile(wavPath, encodeWav(pcm, sampleRate))
    const args = [
      '-l',
      opts.language,
      '-m',
      modelPath(this.opts.modelsDir, model),
      '-f',
      wavPath
    ]
    try {
      const stdout = await this.run(args)
      return buildResult(stdout, opts.final ?? false)
    } finally {
      await fs.rm(wavPath, { force: true }).catch(() => {})
    }
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let child: ChildProcess
      try {
        child = this.spawnFn(this.opts.whisperCli, args)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`whisper-cli код ${code}: ${stderr.trim()}`))
      })
    })
  }
}
