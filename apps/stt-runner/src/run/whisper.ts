import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { buildResult, type WhisperModel } from '@voicechat/shared'
import { encodeWav } from './wav.js'
import { modelPath } from '../models/catalog.js'

export type SpawnFn = (command: string, args: string[]) => ChildProcess
export interface WhisperJobOptions {
  whisperCli: string
  modelsDir: string
  tempDir: string
  killGraceMs: number
  whisperTimeoutMs: number
  spawn?: SpawnFn
}
export interface WhisperJob {
  result: Promise<ReturnType<typeof buildResult>>
  cancel(): void
}
let sequence = 0
export function startWhisper(opts: WhisperJobOptions, pcm: Buffer, model: WhisperModel, language: string): WhisperJob {
  const wavPath = join(opts.tempDir, `vc-stt-${process.pid}-${sequence++}.wav`)
  let child: ChildProcess | undefined
  let cancelled = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    cancelled = true
    if (!child || child.exitCode !== null) return
    child.kill('SIGTERM')
    killTimer = setTimeout(() => { if (child?.exitCode === null) child.kill('SIGKILL') }, opts.killGraceMs)
  }
  const result = (async () => {
    await fs.mkdir(opts.tempDir, { recursive: true })
    await fs.writeFile(wavPath, encodeWav(new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)), 16000))
    return await new Promise<ReturnType<typeof buildResult>>((resolve, reject) => {
      let stdout = ''
      try {
        child = (opts.spawn ?? (nodeSpawn as unknown as SpawnFn))(opts.whisperCli, ['-l', language, '-m', modelPath(opts.modelsDir, model), '-f', wavPath])
      } catch (error) { reject(error); return }
      const timeout = setTimeout(() => { cancel(); reject(Object.assign(new Error('whisper timeout'), { code: 'WHISPER_TIMEOUT' })) }, opts.whisperTimeoutMs)
      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
      child.on('error', reject)
      child.on('close', (code) => {
        clearTimeout(timeout)
        if (cancelled) reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }))
        else if (code === 0) resolve(buildResult(stdout, true))
        else reject(Object.assign(new Error('whisper failed'), { code: 'WHISPER_FAILED' }))
      })
    })
  })().finally(async () => {
    if (killTimer) clearTimeout(killTimer)
    await fs.rm(wavPath, { force: true }).catch(() => undefined)
  })
  return { result, cancel }
}
export async function cleanupOrphanWavs(tempDir: string, olderThanMs: number, now = Date.now()): Promise<number> {
  await fs.mkdir(tempDir, { recursive: true })
  const names = await fs.readdir(tempDir)
  let removed = 0
  for (const name of names) {
    if (!/^vc-stt-\d+-\d+\.wav$/.test(name)) continue
    const path = join(tempDir, name)
    const stat = await fs.stat(path).catch(() => null)
    if (stat && now - stat.mtimeMs >= olderThanMs) {
      await fs.rm(path, { force: true })
      removed++
    }
  }
  return removed
}
