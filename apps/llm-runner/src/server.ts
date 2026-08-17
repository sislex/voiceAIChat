import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
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
import { getLoginStatus } from './auth/loginStatus.js'
import { readUserFile } from './fs/userFiles.js'
import { listProjects, listSessions, readTranscript, readUsage, watchTranscriptFromOffset } from './fs/ccSessions.js'
import {
  listCxProjects,
  listCxSessions,
  readCxTranscript,
  readCxUsage,
  watchCxTranscriptFromOffset
} from './fs/codexSessions.js'

const RUNNER_AUTH_STATUS_PATH = '/v1/auth/status'
const RUNNER_FILE_READ_PATH = '/v1/files/read'
const RUNNER_CC_PROJECTS_PATH = '/v1/fs/cc/projects'
const RUNNER_CC_WATCH_PATH = '/v1/fs/cc/watch'
const RUNNER_CX_PROJECTS_PATH = '/v1/fs/cx/projects'
const RUNNER_CX_SESSIONS_PATH = '/v1/fs/cx/sessions'
const RUNNER_CX_TRANSCRIPT_PATH = '/v1/fs/cx/transcript'
const RUNNER_CX_WATCH_PATH = '/v1/fs/cx/watch'

export interface BuildRunnerOptions {
  config: RunnerConfig
  runs?: RunManager
  health?: () => Promise<LlmRunnerHealth>
  authStatus?: (userId: string) => Promise<import('@voicechat/shared').LoginStatusMap>
}

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
  if (body.kind !== 'claude' && body.kind !== 'codex') return 'kind: claude | codex'
  // У codex пустая модель — норма: `settings.codexModel` по умолчанию '', тогда
  // `codexInvocation` не добавляет `-m` и модель берётся из config.toml самого CLI.
  // Требование непустой строки роняло КАЖДЫЙ ход codex через удалённого исполнителя.
  if (typeof body.model !== 'string') return 'model обязательна'
  if (!body.model && body.kind === 'claude') return 'model обязательна'
  return null
}

function requireUserId(
  req: FastifyRequest<{ Querystring: { userId?: string } }>,
  reply: FastifyReply
): string | null {
  const userId = req.query.userId?.trim()
  if (userId) return userId
  void reply.code(400).send({ error: 'bad_request', message: 'userId обязателен' })
  return null
}

function sseHeaders(reply: FastifyReply): ServerResponse {
  const res = reply.raw
  res.socket?.setNoDelay(true)
  reply.hijack()
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  res.flushHeaders()
  return res
}

function sendSse(res: ServerResponse, id: number, payload: unknown): void {
  res.write(`id: ${id}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function lastEventId(req: FastifyRequest): number | undefined {
  const raw = req.headers['last-event-id']
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export async function buildRunner(opts: BuildRunnerOptions): Promise<FastifyInstance> {
  const { config } = opts
  if (!config.token) throw new Error('исполнитель без VC_RUNNER_TOKEN не поднимается')

  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 })
  registerRunnerAuth(app, config.token)

  const runs =
    opts.runs ??
    new RunManager({
      claudeBin: config.claudeBin,
      codexBin: config.codexBin,
      orphanMs: config.orphanMs,
      profileHome: (userId) =>
        ensureCliProfile(config.dataDir, userId, config.home, { sharedCodexAuth: config.sharedCodexAuth === true, sharedCodexAuthUser: config.sharedCodexAuthUser }).home
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

  const profile = (userId: string) =>
    ensureCliProfile(config.dataDir, userId, config.home, { sharedCodexAuth: config.sharedCodexAuth === true, sharedCodexAuthUser: config.sharedCodexAuthUser })

  app.post<{ Body: LlmRunBody }>(LLM_RUNNER.run, async (req, reply) => {
    const problem = badRequest(req.body)
    if (problem) return reply.code(400).send({ error: 'bad_request', message: problem })

    if (req.body.runId && runs.has(req.body.runId)) {
      return reply.code(409).send({ error: 'run_exists' })
    }

    const body: LlmRunBody = { ...req.body, sessionId: req.body.sessionId ?? null }
    const id = body.runId || randomUUID()
    const res = reply.raw
    res.socket?.setNoDelay(true)
    reply.hijack()
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      [LLM_RUN_ID_HEADER]: id
    })
    res.flushHeaders()
    runs.start({ ...body, runId: id }, responseSink(res))
  })

  app.delete<{ Params: { id: string } }>(`${LLM_RUNNER.run}/:id`, async (req) => ({
    stopped: runs.cancel(req.params.id)
  }))

  app.get(LLM_RUNNER.health, async () => health())

  app.get<{ Querystring: { userId?: string } }>(RUNNER_AUTH_STATUS_PATH, async (req, reply) => {
    const userId = requireUserId(req, reply)
    if (!userId) return
    return opts.authStatus
      ? opts.authStatus(userId)
      : getLoginStatus({ home: profile(userId).home, claudeBin: config.claudeBin })
  })

  app.get<{ Querystring: { userId?: string; path?: string } }>(RUNNER_FILE_READ_PATH, async (req, reply) => {
    const userId = requireUserId(req as FastifyRequest<{ Querystring: { userId?: string } }>, reply)
    if (!userId) return
    const res = readUserFile(req.query.path ?? '', [profile(userId).home])
    if (!res.ok) {
      const code = res.reason === 'too-large' ? 413 : 404
      return reply.code(code).send({ error: res.reason })
    }
    return res.file
  })

  app.get<{ Querystring: { userId?: string } }>(RUNNER_CC_PROJECTS_PATH, async (req, reply) => {
    const userId = requireUserId(req, reply)
    if (!userId) return
    return listProjects(profile(userId).ccProjects)
  })

  app.get<{ Params: { slug: string }; Querystring: { userId?: string } }>(
    '/v1/fs/cc/projects/:slug/sessions',
    async (req, reply) => {
      const userId = requireUserId(req as FastifyRequest<{ Querystring: { userId?: string } }>, reply)
      if (!userId) return
      return listSessions(req.params.slug, profile(userId).ccProjects)
    }
  )

  app.get<{ Params: { slug: string; id: string }; Querystring: { userId?: string; limit?: string } }>(
    '/v1/fs/cc/projects/:slug/sessions/:id',
    async (req, reply) => {
      const userId = requireUserId(req as FastifyRequest<{ Querystring: { userId?: string } }>, reply)
      if (!userId) return
      const dir = profile(userId).ccProjects
      const items = readTranscript(
        req.params.slug,
        req.params.id,
        { limit: req.query.limit ? Number(req.query.limit) : undefined },
        dir
      )
      return { items, usage: readUsage(req.params.slug, req.params.id, dir) }
    }
  )

  app.get<{ Querystring: { userId?: string; slug?: string; id?: string } }>(RUNNER_CC_WATCH_PATH, async (req, reply) => {
    const userId = requireUserId(req, reply)
    if (!userId) return
    const slug = req.query.slug ?? ''
    const id = req.query.id ?? ''
    if (!slug || !id) return reply.code(400).send({ error: 'bad_request', message: 'slug и id обязательны' })
    const res = sseHeaders(reply)
    const stop = watchTranscriptFromOffset(
      slug,
      id,
      lastEventId(req),
      (items, nextOffset) => sendSse(res, nextOffset, { items }),
      profile(userId).ccProjects
    )
    req.raw.on('close', stop)
  })

  app.get<{ Querystring: { userId?: string } }>(RUNNER_CX_PROJECTS_PATH, async (req, reply) => {
    const userId = requireUserId(req, reply)
    if (!userId) return
    return listCxProjects(profile(userId).codexSessions)
  })

  app.get<{ Querystring: { userId?: string; cwd?: string } }>(RUNNER_CX_SESSIONS_PATH, async (req, reply) => {
    const userId = requireUserId(req, reply)
    if (!userId) return
    return listCxSessions(req.query.cwd ?? '', profile(userId).codexSessions)
  })

  app.get<{ Querystring: { userId?: string; id?: string; limit?: string } }>(RUNNER_CX_TRANSCRIPT_PATH, async (req, reply) => {
    const userId = requireUserId(req, reply)
    if (!userId) return
    const dir = profile(userId).codexSessions
    const id = req.query.id ?? ''
    const items = readCxTranscript(id, { limit: req.query.limit ? Number(req.query.limit) : undefined }, dir)
    return { items, usage: readCxUsage(id, dir) }
  })

  app.get<{ Querystring: { userId?: string; id?: string } }>(RUNNER_CX_WATCH_PATH, async (req, reply) => {
    const userId = requireUserId(req, reply)
    if (!userId) return
    const id = req.query.id ?? ''
    if (!id) return reply.code(400).send({ error: 'bad_request', message: 'id обязателен' })
    const res = sseHeaders(reply)
    const stop = watchCxTranscriptFromOffset(
      id,
      lastEventId(req),
      (items, nextOffset) => sendSse(res, nextOffset, { items }),
      profile(userId).codexSessions
    )
    req.raw.on('close', stop)
  })

  app.addHook('onClose', async () => runs.cancelAll())

  return app
}
