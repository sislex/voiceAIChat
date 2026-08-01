import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { parseLlmRunFrame, type LlmRunFrame, type LlmRunnerHealth } from '@voicechat/shared'
import { buildRunner } from './server.js'
import type { RunnerConfig } from './config.js'
import { RunManager } from './run/rawRun.js'
import type { SpawnFn } from './cli/claudeCli.js'

const TOKEN = 'секрет-исполнителя'

const config = (over: Partial<RunnerConfig> = {}): RunnerConfig => ({
  host: '127.0.0.1',
  port: 0,
  token: TOKEN,
  dataDir: '/tmp/voicechat-runner-test',
  home: '/tmp/voicechat-runner-test/home',
  claudeBin: 'claude',
  codexBin: 'codex',
  orphanMs: 60_000,
  ...over
})

const health: LlmRunnerHealth = {
  ok: true,
  bins: {
    claude: { present: true, version: '1.2.3 (Claude Code)' },
    codex: { present: false, version: null }
  },
  login: {
    claude: { provider: 'claude', loggedIn: true, detail: 'подписка' },
    codex: { provider: 'codex', loggedIn: false }
  },
  runs: 0
}

function fakeChild(): {
  child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough }
  stdout: PassThrough
  stderr: PassThrough
  signals: string[]
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const signals: string[] = []
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout,
    stderr,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: (s: NodeJS.Signals) => {
      signals.push(s)
      return true
    }
  })
  return { child, stdout, stderr, signals }
}

/** Дать событиям потоков доехать (readline закрывается не синхронно). */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

const runBody = {
  kind: 'claude' as const,
  prompt: 'привет',
  sessionId: null,
  model: 'sonnet'
}

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('исполнитель: аутентификация', () => {
  it('без Bearer → 401 на всех /v1/*', async () => {
    app = await buildRunner({ config: config(), health: async () => health })

    for (const req of [
      { method: 'POST' as const, url: '/v1/run', payload: runBody },
      { method: 'GET' as const, url: '/v1/health' },
      { method: 'DELETE' as const, url: '/v1/run/r-any' }
    ]) {
      const res = await app.inject(req)
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
    }
  })

  it('чужой токен → 401, верный → 200', async () => {
    app = await buildRunner({ config: config(), health: async () => health })

    const bad = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { authorization: 'Bearer не-тот' }
    })
    expect(bad.statusCode).toBe(401)

    const ok = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(ok.statusCode).toBe(200)
    expect((ok.json() as LlmRunnerHealth).bins.claude.version).toBe('1.2.3 (Claude Code)')
  })

  it('исполнитель без токена не собирается', async () => {
    await expect(buildRunner({ config: config({ token: '' }) })).rejects.toThrow(/VC_RUNNER_TOKEN/)
  })
})

describe('POST /v1/run', () => {
  it('строки stdout доходят до клиента по одной, пока CLI жив', async () => {
    const { child, stdout, stderr } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    app = await buildRunner({
      config: config(),
      runs: new RunManager({ spawn }),
      health: async () => health
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = boundPort(app)

    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...runBody, runId: 'r-1' })
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    // id рана известен клиенту сразу — до первого байта вывода модели.
    expect(res.headers.get('x-run-id')).toBe('r-1')

    const frames = lineReader(res)
    const line = JSON.stringify({ type: 'result', is_error: false, result: 'Привет' })
    stdout.write(line + '\n')
    expect(await frames.next()).toEqual({ t: 'out', s: line })

    stderr.write('шум\n')
    expect(await frames.next()).toEqual({ t: 'err', s: 'шум' })

    stdout.end()
    stderr.end()
    await tick()
    child.emit('close', 0)
    expect(await frames.next()).toEqual({ t: 'exit', code: 0 })
    // Поток закрыт кадром exit — сервер по нему завершает ход.
    expect(await frames.next()).toBeNull()
  })

  it('битое тело → 400 без запуска CLI', async () => {
    const spawn = vi.fn() as unknown as SpawnFn
    app = await buildRunner({
      config: config(),
      runs: new RunManager({ spawn }),
      health: async () => health
    })

    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: 'привет', sessionId: null, model: 'sonnet' }
    })
    expect(res.statusCode).toBe(400)
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('DELETE /v1/run/:id', () => {
  it('гасит процесс, повторный вызов безопасен', async () => {
    const { child, stdout, stderr, signals } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const runs = new RunManager({ spawn })
    app = await buildRunner({ config: config(), runs, health: async () => health })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = boundPort(app)

    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...runBody, runId: 'r-kill' })
    })
    await vi.waitUntil(() => runs.size === 1)

    // Тот же runId, пока ран жив → 409, а не второй процесс под тем же адресом.
    const dup = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { ...runBody, runId: 'r-kill' }
    })
    expect(dup.statusCode).toBe(409)

    const first = await app.inject({
      method: 'DELETE',
      url: '/v1/run/r-kill',
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(first.json()).toEqual({ stopped: true })
    expect(signals).toEqual(['SIGTERM'])

    // CLI умер — поток закрывается кадром exit, ран уходит из реестра.
    stdout.end()
    stderr.end()
    await tick()
    child.emit('close', null)
    await res.text()

    const second = await app.inject({
      method: 'DELETE',
      url: '/v1/run/r-kill',
      headers: { authorization: `Bearer ${TOKEN}` }
    })
    expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual({ stopped: false })
  })
})

/** Порт, на который встал тестовый исполнитель. */
function boundPort(instance: FastifyInstance): number {
  const addr = instance.server.address()
  return typeof addr === 'object' && addr ? addr.port : 0
}

/** Построчное чтение NDJSON-ответа: кадр за кадром, как их читает сервер. */
function lineReader(res: Response): { next: () => Promise<LlmRunFrame | null> } {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const take = (): LlmRunFrame | null => {
    const idx = buffer.indexOf('\n')
    if (idx < 0) return null
    const line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 1)
    return parseLlmRunFrame(line)
  }
  return {
    next: async () => {
      for (;;) {
        const frame = take()
        if (frame) return frame
        const { done, value } = await reader.read()
        if (done) return null
        buffer += decoder.decode(value, { stream: true })
      }
    }
  }
}
