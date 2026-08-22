import { describe, it, expect, vi } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { ClaudeCli, type SpawnFn } from '../claude/claudeCli.js'
import { CodexCli } from '../codex/codexCli.js'
import { RemoteLlmClient } from './remoteClient.js'
import type { RunnerRunBody } from './protocol.js'
import type { LlmClient, LlmStreamHandlers } from '../claude/types.js'

// --- фейковый исполнитель на 127.0.0.1 ------------------------------------

interface FakeRunner {
  url: string
  /** Тела принятых POST /v1/run. */
  posts: RunnerRunBody[]
  /** URL принятых DELETE /v1/run/:id. */
  deletes: string[]
  /** Заголовок authorization принятых DELETE. */
  deleteAuth: Array<string | undefined>
  close(): Promise<void>
}

type RunHandler = (res: ServerResponse, body: RunnerRunBody, req: IncomingMessage) => void

async function startRunner(handle: RunHandler): Promise<FakeRunner> {
  const posts: RunnerRunBody[] = []
  const deletes: string[] = []
  const deleteAuth: Array<string | undefined> = []
  const server = createServer((req, res) => {
    if (req.method === 'DELETE') {
      deletes.push(req.url ?? '')
      deleteAuth.push(req.headers.authorization)
      res.writeHead(204).end()
      return
    }
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString()
    })
    req.on('end', () => {
      const body = JSON.parse(raw) as RunnerRunBody
      posts.push(body)
      handle(res, body, req)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    posts,
    deletes,
    deleteAuth,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

/** Отдаёт строки stdout CLI конвертами NDJSON и закрывает ход кодом выхода. */
function ndjson(res: ServerResponse, lines: string[], code: number | null = 0): void {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' })
  for (const s of lines) res.write(`${JSON.stringify({ t: 'out', s })}\n`)
  res.write(`${JSON.stringify({ t: 'exit', code })}\n`)
  res.end()
}

// --- сбор событий хода -----------------------------------------------------

interface Collected {
  handlers: LlmStreamHandlers
  events: unknown[]
  finished: Promise<void>
}

function collect(): Collected {
  const events: unknown[] = []
  let resolve!: () => void
  const finished = new Promise<void>((r) => {
    resolve = r
  })
  return {
    events,
    finished,
    handlers: {
      onSession: (sessionId) => events.push({ t: 'session', sessionId }),
      onDelta: (text) => events.push({ t: 'delta', text }),
      onUsage: (usage) => events.push({ t: 'usage', usage }),
      onDone: (text, meta) => {
        events.push({ t: 'done', text, meta })
        resolve()
      },
      onError: (message) => {
        events.push({ t: 'error', message })
        resolve()
      }
    }
  }
}

/** Фейковый дочерний процесс для локального spawn. */
function fakeChild(): {
  child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void }
  stdout: PassThrough
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdout, stderr, stdin, kill: vi.fn() })
  return { child, stdout }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

/** Тот же ход через локальный spawn: эталон событий для сравнения. */
async function localEvents(
  make: (spawn: SpawnFn) => LlmClient,
  lines: string[]
): Promise<unknown[]> {
  const { child, stdout } = fakeChild()
  const spawn: SpawnFn = vi.fn(() => child as never)
  const c = collect()
  make(spawn).send({ prompt: 'привет', sessionId: null, model: 'sonnet' }, c.handlers)
  for (const line of lines) stdout.write(`${line}\n`)
  stdout.end()
  await tick()
  child.emit('close', 0)
  await c.finished
  return c.events
}

const CLAUDE_LINES = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'sonnet' }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 12 } } }
  }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'При' } }
  }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'вет' } }
  }),
  JSON.stringify({
    type: 'stream_event',
    event: { type: 'message_delta', usage: { output_tokens: 5 } }
  }),
  JSON.stringify({
    type: 'result',
    is_error: false,
    result: 'Привет',
    session_id: 's1',
    duration_ms: 42,
    usage: { input_tokens: 12, output_tokens: 5 }
  })
]

const CODEX_LINES = [
  JSON.stringify({ type: 'thread.started', thread_id: 'th-1' }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Готово' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 3 } })
]

describe('RemoteLlmClient: ход через исполнителя по HTTP', () => {
  it('даёт те же события, что локальный spawn claude (session/usage/delta/result)', async () => {
    const runner = await startRunner((res) => ndjson(res, CLAUDE_LINES))
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url }).send(
        { prompt: 'привет', sessionId: null, model: 'sonnet' },
        c.handlers
      )
      await c.finished

      expect(c.events).toEqual(await localEvents((spawn) => new ClaudeCli({ spawn }), CLAUDE_LINES))
      expect(c.events).toEqual([
        { t: 'session', sessionId: 's1' },
        { t: 'usage', usage: { inputTokens: 12 } },
        { t: 'delta', text: 'При' },
        { t: 'delta', text: 'вет' },
        { t: 'usage', usage: { inputTokens: 12, outputTokens: 5 } },
        { t: 'session', sessionId: 's1' },
        {
          t: 'done',
          text: 'Привет',
          meta: { durationMs: 42, inputTokens: 12, outputTokens: 5 }
        }
      ])
    } finally {
      await runner.close()
    }
  })

  it('даёт те же события, что локальный spawn codex', async () => {
    const runner = await startRunner((res) => ndjson(res, CODEX_LINES))
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'codex', baseUrl: runner.url }).send(
        { prompt: 'привет', sessionId: null, model: 'sonnet' },
        c.handlers
      )
      await c.finished
      expect(c.events).toEqual(await localEvents((spawn) => new CodexCli({ spawn }), CODEX_LINES))
    } finally {
      await runner.close()
    }
  })

  it('передаёт исполнителю запрос целиком: kind, prompt, resume, mcp-адреса', async () => {
    const runner = await startRunner((res) => ndjson(res, CLAUDE_LINES))
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url, token: 'secret-token' }).send(
        {
          userId: 'admin',
          prompt: 'задача',
          sessionId: 'sess-7',
          model: 'opus',
          permissionMode: 'bypassPermissions',
          cwd: '/root/work',
          attachments: [{ serverPath: '/data/uploads/a.txt', runnerName: 'a.txt', dataBase64: 'YQ==' }],
          kbMcpUrl: 'http://127.0.0.1:8787/mcp/kb?k=x',
          remote: { mcpUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=y', agentName: 'Ноутбук' }
        },
        c.handlers
      )
      await c.finished

      const body = runner.posts[0]
      expect(body.kind).toBe('claude')
      expect(typeof body.runId).toBe('string')
      // Поля запроса — на верхнем уровне: вложенный конверт исполнитель отвергает
      // с `400 prompt обязателен` (apps/llm-runner/src/server.ts).
      expect(body).toMatchObject({
        userId: 'admin',
        prompt: 'задача',
        sessionId: 'sess-7',
        model: 'opus',
        permissionMode: 'bypassPermissions',
        cwd: '/root/work',
        attachments: [{ serverPath: '/data/uploads/a.txt', runnerName: 'a.txt', dataBase64: 'YQ==' }],
        kbMcpUrl: 'http://127.0.0.1:8787/mcp/kb?k=x',
        remote: { agentName: 'Ноутбук' }
      })
    } finally {
      await runner.close()
    }
  })

  it('мусор в NDJSON не ломает ход: пустые строки и чужие конверты игнорируются', async () => {
    const runner = await startRunner((res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write('\n')
      res.write('не json\n')
      res.write(`${JSON.stringify({ t: 'keepalive' })}\n`)
      for (const s of CLAUDE_LINES) res.write(`${JSON.stringify({ t: 'out', s })}\n`)
      res.end(`${JSON.stringify({ t: 'exit', code: 0 })}\n`)
    })
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url }).send(
        { prompt: 'привет', sessionId: null, model: 'sonnet' },
        c.handlers
      )
      await c.finished
      expect((c.events.at(-1) as { t: string; text: string }).text).toBe('Привет')
    } finally {
      await runner.close()
    }
  })

  it('отмена хода уходит на DELETE /v1/run/:id и глушит дальнейшие события', async () => {
    const streams: ServerResponse[] = []
    const runner = await startRunner((res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ t: 'out', s: CLAUDE_LINES[0] })}\n`)
      streams.push(res)
    })
    try {
      const c = collect()
      const handle = new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url }).send(
        { prompt: 'привет', sessionId: null, model: 'sonnet' },
        c.handlers
      )
      // Ждём первую строку — значит ран у исполнителя уже начался.
      while (!c.events.length) await tick()

      handle.cancel()
      while (!runner.deletes.length) await tick()
      expect(runner.deletes[0]).toBe(`/v1/run/${runner.posts[0].runId}`)

      // Даже если исполнитель успел досказать ход, событий больше не будет.
      streams[0].write(`${JSON.stringify({ t: 'out', s: CLAUDE_LINES[5] })}\n`)
      streams[0].end()
      await tick()
      await tick()
      expect(c.events).toEqual([{ t: 'session', sessionId: 's1' }])
    } finally {
      await runner.close()
    }
  })

  it('обрыв соединения закрывает ход понятной ошибкой, а не зависанием', async () => {
    const runner = await startRunner((res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ t: 'out', s: CLAUDE_LINES[0] })}\n`)
      // Обрыв посреди хода: exit-конверта не будет.
      setTimeout(() => res.destroy(), 10)
    })
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url }).send(
        { prompt: 'привет', sessionId: null, model: 'sonnet' },
        c.handlers
      )
      await c.finished
      const last = c.events.at(-1) as { t: string; message: string }
      expect(last.t).toBe('error')
      expect(last.message).toContain('оборвалось')
      expect(last.message).toContain('Повторите запрос.')
    } finally {
      await runner.close()
    }
  })

  it('поток без exit-конверта тоже закрывает ход', async () => {
    const runner = await startRunner((res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.end(`${JSON.stringify({ t: 'out', s: CLAUDE_LINES[0] })}\n`)
    })
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url }).send(
        { prompt: 'привет', sessionId: null, model: 'sonnet' },
        c.handlers
      )
      await c.finished
      expect((c.events.at(-1) as { t: string }).t).toBe('error')
    } finally {
      await runner.close()
    }
  })

  it('ненулевой код выхода объясняется stderr исполнителя', async () => {
    const runner = await startRunner((res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ t: 'err', s: 'Please run `claude login`' })}\n`)
      res.end(`${JSON.stringify({ t: 'exit', code: 1 })}\n`)
    })
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url }).send(
        { prompt: 'привет', sessionId: null, model: 'sonnet' },
        c.handlers
      )
      await c.finished
      expect(c.events).toEqual([
        { t: 'error', message: 'Похоже, вход в Claude не выполнен. Выполните `claude login` в терминале.' }
      ])
    } finally {
      await runner.close()
    }
  })

  it('недоступный исполнитель — человеческий текст вместо сетевого стектрейса', async () => {
    // Порт занят закрытым сервером: соединение отклоняется сразу.
    const runner = await startRunner((res) => ndjson(res, CLAUDE_LINES))
    const url = runner.url
    await runner.close()

    const c = collect()
    new RemoteLlmClient({ kind: 'claude', baseUrl: url }).send(
      { prompt: 'привет', sessionId: null, model: 'sonnet' },
      c.handlers
    )
    await c.finished
    const last = c.events.at(-1) as { t: string; message: string }
    expect(last.t).toBe('error')
    expect(last.message).toContain('недоступен')
    expect(last.message).toContain(url)
  })

  it('отказ авторизации указывает на токен исполнителя', async () => {
    const runner = await startRunner((res) => {
      res.writeHead(401).end('unauthorized')
    })
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'codex', baseUrl: runner.url, token: 'bad' }).send(
        { prompt: 'привет', sessionId: null, model: '' },
        c.handlers
      )
      await c.finished
      expect((c.events.at(-1) as { message: string }).message).toContain('VC_LLM_RUNNER_TOKEN')
    } finally {
      await runner.close()
    }
  })

  it('безопасно объясняет занятый Codex thread и не раскрывает детали ответа', async () => {
    const runner = await startRunner((res) => {
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'codex_thread_in_use', detail: 'internal thread-store conflict SECRET' }))
    })
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'codex', baseUrl: runner.url }).send(
        { prompt: 'продолжай', sessionId: 'thread-1', model: '' },
        c.handlers
      )
      await c.finished
      const message = (c.events.at(-1) as { message: string }).message
      expect(message).toContain('уже выполняется')
      expect(message).toContain('Дождитесь завершения')
      expect(message).toContain('остановите текущий ход')
      expect(message).toContain('сбросьте сессию')
      expect(message).not.toContain('SECRET')
      expect(message).not.toContain('thread-store')
    } finally {
      await runner.close()
    }
  })

  it('не маскирует неизвестный 409 под конфликт Codex thread', async () => {
    const runner = await startRunner((res) => {
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'run_exists' }))
    })
    try {
      const c = collect()
      new RemoteLlmClient({ kind: 'codex', baseUrl: runner.url }).send(
        { prompt: 'продолжай', sessionId: 'thread-1', model: '' },
        c.handlers
      )
      await c.finished
      const message = (c.events.at(-1) as { message: string }).message
      expect(message).toContain('вернул ошибку 409')
      expect(message).not.toContain('сбросьте сессию')
    } finally {
      await runner.close()
    }
  })

  it('Bearer-токен уходит и в запуск, и в отмену', async () => {
    const auth: Array<string | undefined> = []
    const runner = await startRunner((res, _body, req) => {
      auth.push(req.headers.authorization)
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ t: 'out', s: CLAUDE_LINES[0] })}\n`)
    })
    try {
      const client = new RemoteLlmClient({ kind: 'claude', baseUrl: runner.url, token: 'tok-1' })
      const c = collect()
      const handle = client.send({ prompt: 'привет', sessionId: null, model: 'sonnet' }, c.handlers)
      while (!c.events.length) await tick()
      handle.cancel()
      while (!runner.deletes.length) await tick()
      expect(auth[0]).toBe('Bearer tok-1')
      expect(runner.deleteAuth[0]).toBe('Bearer tok-1')
    } finally {
      await runner.close()
    }
  })
})
