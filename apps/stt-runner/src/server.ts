import { existsSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { STT_RUNNER, parseSttControl, sttSegments, type SttRunnerEvent, type SttStart, type WhisperModel } from '@voicechat/shared'
import type { WebSocket } from 'ws'
import { registerRunnerAuth } from './auth.js'
import type { SttRunnerConfig } from './config.js'
import { cleanupOrphanWavs, startWhisper, type SpawnFn, type WhisperJob } from './run/whisper.js'
import { isModelPresent, listModels, modelPath } from './models/catalog.js'
import { downloadModel } from './models/download.js'

interface Run {
  socket: WebSocket
  start: SttStart
  chunks: Buffer[]
  bytes: number
  terminal: boolean
  ended: boolean
  job?: WhisperJob
  idle?: ReturnType<typeof setTimeout>
  partial?: ReturnType<typeof setInterval>
}
export interface BuildRunnerOptions { config: SttRunnerConfig; spawn?: SpawnFn; now?: () => number }
function send(run: Run, event: SttRunnerEvent): void {
  if (run.socket.readyState === run.socket.OPEN) run.socket.send(JSON.stringify(event))
}
export async function buildRunner(opts: BuildRunnerOptions): Promise<FastifyInstance> {
  const { config } = opts
  if (!config.token) throw new Error('STT Runner без VC_STT_RUNNER_TOKEN не поднимается')
  await cleanupOrphanWavs(config.tempDir, config.orphanTimeoutMs)
  const app = Fastify({ logger: false })
  await app.register(websocket)
  registerRunnerAuth(app, config.token)
  const runs = new Map<string, Run>()
  const queue: Run[] = []
  let active = 0

  const terminal = (run: Run, event: Extract<SttRunnerEvent, { t: 'error' | 'cancelled' | 'completed' }>) => {
    if (run.terminal) return
    run.terminal = true
    if (run.idle) clearTimeout(run.idle)
    if (run.partial) clearInterval(run.partial)
    send(run, event)
    runs.delete(run.start.runId)
  }
  const classify = (run: Run, error: unknown) => {
    const code = (error as { code?: string })?.code
    if (code === 'CANCELLED') return
    if (code === 'WHISPER_TIMEOUT') terminal(run, { t: 'error', runId: run.start.runId, code: 'timeout', message: 'Истекло время распознавания', retryable: true, reason: 'whisper' })
    else terminal(run, { t: 'error', runId: run.start.runId, code: 'whisper_failed', message: 'Ошибка распознавания речи', retryable: true })
  }
  const pump = () => {
    while (active < config.maxConcurrentRuns && queue.length) {
      const run = queue.shift()!
      if (run.terminal) continue
      active++
      const pcm = Buffer.concat(run.chunks)
      run.chunks = []
      run.job = startWhisper({ whisperCli: config.whisperCli, modelsDir: config.modelsDir, tempDir: config.tempDir, killGraceMs: config.killGraceMs, whisperTimeoutMs: config.whisperTimeoutMs, spawn: opts.spawn }, pcm, run.start.model, run.start.language)
      void run.job.result.then((result) => {
        if (run.terminal) return
        send(run, { t: 'final', runId: run.start.runId, segments: sttSegments(result.segments), text: result.text })
        terminal(run, { t: 'completed', runId: run.start.runId })
      }).catch((error) => classify(run, error)).finally(() => { active--; pump() })
    }
  }
  const enqueue = (run: Run) => {
    if (active >= config.maxConcurrentRuns && queue.length >= config.maxQueueSize) {
      terminal(run, { t: 'error', runId: run.start.runId, code: 'busy', message: 'Очередь распознавания заполнена', retryable: true })
      return
    }
    queue.push(run)
    pump()
  }
  const cancel = (run: Run, reason: 'client' | 'orphan') => {
    if (run.terminal) return
    const index = queue.indexOf(run)
    if (index >= 0) queue.splice(index, 1)
    run.job?.cancel()
    terminal(run, { t: 'cancelled', runId: run.start.runId, reason })
  }

  app.get(STT_RUNNER.health, async () => {
    const models = listModels(config.modelsDir, { existsSync, statSync })
    return { ok: existsSync(config.whisperCli), whisper: { available: existsSync(config.whisperCli), version: null }, models, memory: { availableBytes: null }, activeRuns: active, queuedRuns: queue.length }
  })
  app.get(STT_RUNNER.models, async () => listModels(config.modelsDir, { existsSync, statSync }))
  app.post<{ Params: { model: WhisperModel } }>(`${STT_RUNNER.models}/:model/download`, async (req, reply) => {
    if (!['large-v3-turbo', 'medium', 'small'].includes(req.params.model)) return reply.code(400).send({ error: 'invalid_request' })
    try { await downloadModel(req.params.model, config.modelsDir, () => undefined); return { ok: true } }
    catch (error) { return reply.code((error as NodeJS.ErrnoException)?.code === 'ENOSPC' ? 507 : 500).send({ error: (error as NodeJS.ErrnoException)?.code === 'ENOSPC' ? 'storage_exhausted' : 'internal' }) }
  })
  app.delete<{ Params: { model: WhisperModel } }>(`${STT_RUNNER.models}/:model`, async (req, reply) => {
    if (!['large-v3-turbo', 'medium', 'small'].includes(req.params.model)) return reply.code(400).send({ error: 'invalid_request' })
    await rm(modelPath(config.modelsDir, req.params.model), { force: true })
    await rm(`${modelPath(config.modelsDir, req.params.model)}.part`, { force: true })
    return { ok: true }
  })
  app.get(STT_RUNNER.transcribe, { websocket: true }, (socket) => {
    let run: Run | undefined
    socket.on('message', (data, binary) => {
      if (binary) {
        if (!run || run.terminal || run.ended) return
        const chunk = Buffer.from(data as Buffer)
        if (chunk.byteLength > config.maxPcmBufferBytes) {
          terminal(run, { t: 'error', runId: run.start.runId, code: 'busy', message: 'PCM-буфер заполнен', retryable: true, reason: 'buffer' })
          return
        }
        if (run.bytes + chunk.byteLength > config.maxPcmBytes) {
          terminal(run, { t: 'error', runId: run.start.runId, code: 'limit_exceeded', message: 'Превышен лимит PCM', retryable: false, reason: 'pcm' })
          return
        }
        run.bytes += chunk.byteLength
        run.chunks.push(chunk)
        if (run.idle) clearTimeout(run.idle)
        run.idle = setTimeout(() => terminal(run!, { t: 'error', runId: run!.start.runId, code: 'timeout', message: 'Нет аудиоданных', retryable: true, reason: 'idle' }), config.idleTimeoutMs)
        return
      }
      let control
      try { control = parseSttControl(JSON.parse(data.toString())) } catch {
        const id = run?.start.runId ?? 'unknown'
        const event: SttRunnerEvent = { t: 'error', runId: id, code: 'invalid_request', message: 'Некорректный запрос STT', retryable: false }
        if (run) terminal(run, event); else socket.send(JSON.stringify(event))
        return
      }
      if (control.t === 'start') {
        if (run || runs.has(control.runId) || !isModelPresent(config.modelsDir, control.model, { existsSync, statSync })) {
          const event: SttRunnerEvent = { t: 'error', runId: control.runId, code: run || runs.has(control.runId) ? 'invalid_request' : 'model_unavailable', message: 'Модель недоступна', retryable: false }
          socket.send(JSON.stringify(event)); return
        }
        run = { socket, start: control, chunks: [], bytes: 0, terminal: false, ended: false }
        runs.set(control.runId, run)
        send(run, { t: 'ready', runId: control.runId, queued: active >= config.maxConcurrentRuns })
        run.idle = setTimeout(() => terminal(run!, { t: 'error', runId: control.runId, code: 'timeout', message: 'Нет аудиоданных', retryable: true, reason: 'idle' }), config.idleTimeoutMs)
        return
      }
      if (!run || control.runId !== run.start.runId) return
      if (control.t === 'cancel') cancel(run, 'client')
      else if (!run.ended) {
        run.ended = true
        if (run.idle) clearTimeout(run.idle)
        if ((run.bytes / 32000) * 1000 > config.maxSessionMs) terminal(run, { t: 'error', runId: run.start.runId, code: 'limit_exceeded', message: 'Превышена длительность', retryable: false, reason: 'duration' })
        else if (run.bytes === 0) { send(run, { t: 'final', runId: run.start.runId, segments: [], text: '' }); terminal(run, { t: 'completed', runId: run.start.runId }) }
        else enqueue(run)
      }
    })
    socket.on('close', () => {
      if (!run || run.terminal) return
      setTimeout(() => { if (run && !run.terminal) cancel(run, 'orphan') }, config.orphanTimeoutMs)
    })
  })
  app.addHook('onClose', async () => { for (const run of runs.values()) cancel(run, 'orphan') })
  return app
}
