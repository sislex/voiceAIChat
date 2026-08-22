// Контракт «сервер ↔ исполнитель»: RemoteLlmClient ходит в НАСТОЯЩИЙ buildRunner
// из @voicechat/llm-runner, а не в фейковый HTTP-сервер теста. Фейк повторяет
// форму тела за клиентом и поэтому пропустил рассинхрон: клиент слал конверт
// `{ id, kind, request }`, исполнитель ждал поля запроса плоско и отвечал
// `400 prompt обязателен` — ходы не запускались вовсе.
//
// Подменяется только RunManager: spawn настоящего CLI в тестах не нужен,
// проверяются валидация тела, авторизация и адресация отмены.

import { describe, it, expect } from 'vitest'
import type { AddressInfo } from 'node:net'
import { buildRunner } from '@voicechat/llm-runner'
import type { FastifyInstance } from 'fastify'
import type { LlmRunBody } from '@voicechat/shared'
import { RemoteLlmClient } from './remoteClient.js'
import type { LlmStreamHandlers } from '../claude/types.js'

const TOKEN = 'runner-token'

const RESULT_LINE = JSON.stringify({
  type: 'result',
  is_error: false,
  result: 'Привет',
  session_id: 's1',
  duration_ms: 1,
  usage: { input_tokens: 1, output_tokens: 1 }
})

/** JSONL codex: у него свой формат вывода, и приёмник сервера разбирает именно его. */
const CODEX_LINES = [
  JSON.stringify({ type: 'thread.started', thread_id: 'th-1' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Привет' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })
]

/** Приёмник ранов вместо RunManager: сохраняет тело и сразу закрывает ход. */
class FakeRuns {
  readonly bodies: LlmRunBody[] = []
  readonly cancelled: string[] = []

  get size(): number {
    return 0
  }

  has(): boolean {
    return false
  }

  reserveCodexThread(): boolean {
    return true
  }

  start(body: LlmRunBody, sink: { write(chunk: string): boolean; end(): void }): string {
    this.bodies.push(body)
    for (const line of body.kind === 'codex' ? CODEX_LINES : [RESULT_LINE]) {
      sink.write(`${JSON.stringify({ t: 'out', s: line })}\n`)
    }
    sink.write(`${JSON.stringify({ t: 'exit', code: 0 })}\n`)
    sink.end()
    return body.runId ?? ''
  }

  cancel(id: string): boolean {
    this.cancelled.push(id)
    return true
  }

  cancelAll(): void {}
}

async function startRunner(): Promise<{ app: FastifyInstance; url: string; runs: FakeRuns }> {
  const runs = new FakeRuns()
  const app = await buildRunner({
    config: {
      host: '127.0.0.1',
      port: 0,
      token: TOKEN,
      dataDir: '/tmp/voicechat-runner-contract',
      home: '/tmp/voicechat-runner-contract/home',
      claudeBin: 'claude',
      codexBin: 'codex',
      orphanMs: 0
    },
    runs: runs as never,
    health: async () => ({
      ok: true,
      bins: { claude: { present: true, version: null }, codex: { present: true, version: null } },
      login: { claude: { loggedIn: true }, codex: { loggedIn: true } } as never,
      runs: 0
    })
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const { port } = app.server.address() as AddressInfo
  return { app, url: `http://127.0.0.1:${port}`, runs }
}

function collect(): { handlers: LlmStreamHandlers; events: unknown[]; finished: Promise<void> } {
  const events: unknown[] = []
  let resolve!: () => void
  const finished = new Promise<void>((r) => {
    resolve = r
  })
  return {
    events,
    finished,
    handlers: {
      onSession: () => {},
      onDelta: (text) => events.push({ t: 'delta', text }),
      onDone: (text) => {
        events.push({ t: 'done', text })
        resolve()
      },
      onError: (message) => {
        events.push({ t: 'error', message })
        resolve()
      }
    }
  }
}

describe('контракт /v1/run: RemoteLlmClient против настоящего исполнителя', () => {
  it('исполнитель принимает тело клиента и доводит ход до done', async () => {
    const runner = await startRunner()
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url, token: TOKEN }).send(
        { userId: 'admin', prompt: 'привет', sessionId: 'sess-1', model: 'sonnet' },
        c.handlers
      )
      await c.finished

      expect(c.events).toEqual([{ t: 'done', text: 'Привет' }])
      expect(runner.runs.bodies).toHaveLength(1)
      expect(runner.runs.bodies[0]).toMatchObject({
        kind: 'claude',
        userId: 'admin',
        prompt: 'привет',
        sessionId: 'sess-1',
        model: 'sonnet'
      })
    } finally {
      await runner.app.close()
    }
  })

  it('codex без выбранной модели доходит до done, а не до 400', async () => {
    const runner = await startRunner()
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'codex', baseUrl: runner.url, token: TOKEN }).send(
        { prompt: 'привет', sessionId: null, model: '' },
        c.handlers
      )
      await c.finished

      // Ответ codex приходит целым `item.completed`, поэтому текст даёт одна delta.
      expect(c.events).toEqual([
        { t: 'delta', text: 'Привет' },
        { t: 'done', text: 'Привет' }
      ])
      expect(runner.runs.bodies[0]).toMatchObject({ kind: 'codex', model: '' })
    } finally {
      await runner.app.close()
    }
  })

  it('без токена исполнитель отвечает 401, и это видно пользователю текстом', async () => {
    const runner = await startRunner()
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'codex', baseUrl: runner.url }).send(
        { prompt: 'привет', sessionId: null, model: 'sonnet' },
        c.handlers
      )
      await c.finished

      expect(runner.runs.bodies).toHaveLength(0)
      expect((c.events[0] as { t: string; message: string }).message).toContain('VC_LLM_RUNNER_TOKEN')
    } finally {
      await runner.app.close()
    }
  })

  it('отмена доходит до того же рана, который клиент открыл', async () => {
    const runner = await startRunner()
    try {
      const c = collect()
      const handle = new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url, token: TOKEN }).send(
        { prompt: 'привет', sessionId: null, model: 'sonnet' },
        c.handlers
      )
      await c.finished
      handle.cancel()
      while (!runner.runs.cancelled.length) await new Promise((r) => setTimeout(r, 5))

      expect(runner.runs.cancelled[0]).toBe(runner.runs.bodies[0].runId)
    } finally {
      await runner.app.close()
    }
  })
})
