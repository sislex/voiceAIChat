// TTS-движок на macOS `say` (Шаг TTS-C). Синтезирует текст во временный WAV
// (16-bit LE @22050, mono) и возвращает его байты. spawn инжектируется для тестов.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TtsVoiceInfo } from '@voicechat/shared'
import { prepareTtsText } from '@voicechat/shared'
import { parseSayVoices, sayVoiceName } from './sayVoices'
import type { SpeakOptions, TtsAudio, TtsEngine } from './types'

export type SpawnFn = (command: string, args: string[]) => ChildProcess

export interface SayTtsOptions {
  spawn?: SpawnFn
  /** Частота дискретизации вывода (Гц). */
  sampleRate?: number
}

let tempCounter = 0

export class SayTtsEngine implements TtsEngine {
  private current: ChildProcess | null = null
  private readonly spawnFn: SpawnFn
  private readonly sampleRate: number

  constructor(opts: SayTtsOptions = {}) {
    this.spawnFn = opts.spawn ?? (nodeSpawn as unknown as SpawnFn)
    this.sampleRate = opts.sampleRate ?? 22_050
  }

  async synthesize(text: string, opts: SpeakOptions): Promise<TtsAudio> {
    const clean = prepareTtsText(text)
    const wavPath = join(tmpdir(), `voicechat-tts-${process.pid}-${tempCounter++}.wav`)
    const args = [
      '-v',
      sayVoiceName(opts.voice),
      '--data-format=LEI16@' + this.sampleRate,
      '-o',
      wavPath,
      '-f',
      '-' // текст читаем из stdin (безопасно для длинных/многострочных)
    ]

    await new Promise<void>((resolve, reject) => {
      let stderr = ''
      let child: ChildProcess
      try {
        child = this.spawnFn('say', args)
      } catch (err) {
        reject(new Error(`Не удалось запустить say: ${err instanceof Error ? err.message : err}`))
        return
      }
      this.current = child
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      child.on('error', (err) => reject(new Error(`say: ${err.message}`)))
      child.on('close', (code) => {
        this.current = null
        if (code === 0) resolve()
        else reject(new Error(`say завершился с кодом ${code}${stderr ? `: ${stderr.trim()}` : ''}`))
      })
      child.stdin?.end(clean)
    })

    try {
      const buf = await fs.readFile(wavPath)
      const audio = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      return { audio, mime: 'audio/wav' }
    } finally {
      await fs.rm(wavPath, { force: true }).catch(() => {})
    }
  }

  cancel(): void {
    if (this.current) {
      try {
        this.current.kill('SIGTERM')
      } catch {
        /* уже завершён */
      }
      this.current = null
    }
  }

  async listVoices(): Promise<TtsVoiceInfo[]> {
    return new Promise((resolve) => {
      let stdout = ''
      let child: ChildProcess
      try {
        child = this.spawnFn('say', ['-v', '?'])
      } catch {
        resolve([])
        return
      }
      child.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString()
      })
      child.on('error', () => resolve([]))
      child.on('close', () => resolve(parseSayVoices(stdout)))
    })
  }
}
