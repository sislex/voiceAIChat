// Сборка Fastify-приложения исполнителя. Как и на сервере, `buildRunner()`
// отделён от `listen()` (`index.ts`), а внешние ресурсы инъектируются: тесты
// поднимают исполнителя с фейковым spawn и фейковым health, не трогая реальные CLI.

import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  LLM_RUNNER,
  LLM_RUN_ID_HEADER,
  type LlmRunBody,
  type LlmRunnerHealth
} from '@voicechat/shared'
import { registerRunnerAuth } from './auth.js'
import { ensureCliProfile } from './cli/cliProfiles.js'
import type { RunnerConfig } from './config.js'
import { RunManager, type RunSink } from './run/rawRun.js'
import { runnerHealth } from './health.js'

export interface BuildRunnerOptions {
  config: RunnerConfig
  /** Менеджер ранов (в тестах — с фейковым spawn). */
  runs?: RunManager
  /** Сбор health (в тестах — фейк вместо запуска бинарей). */
  health?: () => Promise<LlmRunnerHealth>
}

/**
 * NDJSON поверх сырого ответа Node. Fastify-ответ здесь не годится: он сериализует
 * тело целиком, а строки CLI должны уходить клиенту по одной, пока модель отвечает.
 */
function responseSink(res: ServerResponse): RunSink {
  return {
    write: (chunk) => res.write(chunk),
    onDrain: (cb) => void res.on('drain', cb),
    onClose: (cb) => void res.on('close', cb),
    end: () => {
      if (!res.writableEnded) res.end()
    }
  }
}

function badRequest(body: LlmRunBody | undefined): string | null {
  if (!body || typeof body !== 'object') return 'тело запроса обязательно'
  if (typeof body.prompt !== 'string' || !body.prompt) return 'prompt обязателен'
  if (typeof body.model !== 'string' || !body.model) return 'model обязательна'
  if (body.kind !== 'claude' && body.kind !== 'codex') return 'kind: claude | codex'
  return null
}

export async function buildRunner(opts: BuildRunnerOptions): Promise<FastifyInstance> {
  const { config } = opts
  if (!config.token) throw new Error('исполнитель без VC_RUNNER_TOKEN не поднимается')

  // Промпт хода несёт всю историю разговора и вырезки БЗ — дефолтного лимита в 1 МБ
  // не хватает уже на средней длине чата.
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 })
  registerRunnerAuth(app, config.token)

  const runs =
    opts.runs ??
    new RunManager({
      claudeBin: config.claudeBin,
      codexBin: config.codexBin,
      orphanMs: config.orphanMs,
      profileHome: (userId) => ensureCliProfile(config.dataDir, userId, config.home).home
    })
  const health =
    opts.health ??
    (() =>
      runnerHealth({
        home: config.home,
        claudeBin: config.claudeBin,
        codexBin: config.codexBin,
        runs: () => runs.size
      }))

  app.post<{ Body: LlmRunBody }>(LLM_RUNNER.run, async (req, reply) => {
    const problem = badRequest(req.body)
    if (problem) return reply.code(400).send({ error: 'bad_request', message: problem })

    // Повторный запуск под живым id оставил бы первый CLI без адреса для отмены.
    if (req.body.runId && runs.has(req.body.runId)) {
      return reply.code(409).send({ error: 'run_exists' })
    }

    const body: LlmRunBody = { ...req.body, sessionId: req.body.sessionId ?? null }
    const id = body.runId || randomUUID()
    const res = reply.raw
    // Nagle склеивал бы короткие строки stream-json в пакеты — для живого стрима
    // задержка заметна на глаз.
    res.socket?.setNoDelay(true)
    reply.hijack()
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Иначе обратный прокси (Caddy/nginx) собрал бы поток в буфер.
      'x-accel-buffering': 'no',
      [LLM_RUN_ID_HEADER]: id
    })
    // Без этого Node держит заголовки до первого чанка, и клиент не узнал бы id
    // рана (а значит, не смог бы отменить ход), пока модель думает.
    res.flushHeaders()
    runs.start({ ...body, runId: id }, responseSink(res))
  })

  app.delete<{ Params: { id: string } }>(`${LLM_RUNNER.run}/:id`, async (req) => ({
    // false — рана уже нет (успел завершиться сам). Повторная отмена безопасна.
    stopped: runs.cancel(req.params.id)
  }))

  app.get(LLM_RUNNER.health, async () => health())

  app.addHook('onClose', async () => runs.cancelAll())

  return app
}
