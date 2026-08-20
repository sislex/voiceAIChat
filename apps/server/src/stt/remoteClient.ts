import WebSocket from 'ws'
import { STT_RUNNER, type SttClientControl, type SttRunnerEvent, type SttRunnerHealth, type WhisperModel, type WhisperModelInfo } from '@voicechat/shared'
import type { SttClient, SttRun } from './client.js'
export interface RemoteSttClientOptions { baseUrl: string; token: string; connectTimeoutMs?: number }
export class RemoteSttClient implements SttClient {
  constructor(private readonly opts: RemoteSttClientOptions) {}
  private url(path: string): URL { return new URL(path, this.opts.baseUrl.endsWith('/') ? this.opts.baseUrl : `${this.opts.baseUrl}/`) }
  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.url(path), { ...init, headers: { authorization: `Bearer ${this.opts.token}`, ...init?.headers }, signal: AbortSignal.timeout(this.opts.connectTimeoutMs ?? 5000) })
    if (!response.ok) throw new Error(`STT Runner HTTP ${response.status}`)
    return response.json() as Promise<T>
  }
  health(): Promise<SttRunnerHealth> { return this.json(STT_RUNNER.health) }
  models(): Promise<WhisperModelInfo[]> { return this.json(STT_RUNNER.models) }
  async deleteModel(model: WhisperModel): Promise<void> { await this.json(`${STT_RUNNER.models}/${encodeURIComponent(model)}`, { method: 'DELETE' }) }
  async downloadModel(model: WhisperModel, onProgress: (percent: number) => void): Promise<void> { onProgress(0); await this.json(`${STT_RUNNER.models}/${encodeURIComponent(model)}/download`, { method: 'POST' }); onProgress(100) }
  start(input: { runId: string; model: WhisperModel; language: string; diarization: boolean }, onEvent: (event: SttRunnerEvent) => void): SttRun {
    const url = this.url(STT_RUNNER.transcribe); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.opts.token}` }, handshakeTimeout: this.opts.connectTimeoutMs ?? 5000 })
    const pending: Array<Buffer | string> = []
    let closed = false
    const send = (value: Buffer | string) => { if (closed) return; if (ws.readyState === WebSocket.OPEN) ws.send(value); else pending.push(value) }
    ws.on('open', () => {
      const start: SttClientControl = { t: 'start', schemaVersion: 1, runId: input.runId, format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }, model: input.model, language: input.language, diarization: input.diarization }
      ws.send(JSON.stringify(start)); for (const value of pending.splice(0)) ws.send(value)
    })
    ws.on('message', (data) => { try { onEvent(JSON.parse(data.toString()) as SttRunnerEvent) } catch { /* malformed runner event */ } })
    ws.on('error', () => onEvent({ t: 'error', runId: input.runId, code: 'internal', message: 'STT Runner недоступен', retryable: true }))
    return {
      write: (pcm) => send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
      end: () => send(JSON.stringify({ t: 'end', runId: input.runId } satisfies SttClientControl)),
      cancel: () => { send(JSON.stringify({ t: 'cancel', runId: input.runId } satisfies SttClientControl)); closed = true; setTimeout(() => ws.close(), 0) }
    }
  }
}
