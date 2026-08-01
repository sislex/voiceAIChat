import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerRemoteBashMcp, quoteCwd } from './remoteBashMcp'
import type { AgentRegistry, ExecResult } from '../agents/registry'

const SECRET = 'test-secret'

/** Заглушка реестра: возвращает заранее заданный результат exec. */
function stubRegistry(result: ExecResult | Error): AgentRegistry {
  return {
    exec: async () => {
      if (result instanceof Error) throw result
      return result
    },
    cancelAll: () => {}
  } as unknown as AgentRegistry
}

async function makeApp(registry: AgentRegistry): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  registerRemoteBashMcp(app, registry, SECRET)
  await app.ready()
  return app
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream'
}

/** Один JSON-RPC вызов к MCP-эндпоинту. */
async function rpc(
  app: FastifyInstance,
  body: unknown,
  query = `?k=${SECRET}&agent=a1`
): Promise<{ statusCode: number; json: () => unknown }> {
  const res = await app.inject({
    method: 'POST',
    url: `/mcp/remote-bash${query}`,
    headers: MCP_HEADERS,
    payload: body as object
  })
  return { statusCode: res.statusCode, json: () => res.json() }
}

describe('quoteCwd', () => {
  it('POSIX: экранирует одинарные кавычки, слэши не трогает', () => {
    expect(quoteCwd('/repos/p 1')).toBe('/repos/p 1')
    expect(quoteCwd("/repos/o'brien")).toBe(`/repos/o'"'"'brien`)
  })
  it('win32: бэкслеши нормализуются в прямые слэши', () => {
    expect(quoteCwd('C:\\Users\\dev\\project', 'win32')).toBe('C:/Users/dev/project')
  })
  it('не-win32 платформа: бэкслеши остаются как есть', () => {
    expect(quoteCwd('C:\\Users\\dev', 'linux')).toBe('C:\\Users\\dev')
  })
})

describe('remoteBashMcp', () => {
  let app: FastifyInstance
  afterEach(async () => {
    await app.close()
  })

  const INIT_BODY = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
  }

  /** Реестр-шпион: запоминает команду, посланную в exec, и отдаёт заданную платформу. */
  function spyRegistry(platform: string | undefined): { registry: AgentRegistry; lastCommand: () => string } {
    let lastCommand = ''
    const registry = {
      exec: async (_agentId: string, command: string) => {
        lastCommand = command
        return { exitCode: 0, output: '', timedOut: false }
      },
      cancelAll: () => {},
      platformOf: () => platform
    } as unknown as AgentRegistry
    return { registry, lastCommand: () => lastCommand }
  }

  it('cwd на POSIX-машине оборачивается в cd -- без изменения пути', async () => {
    const { registry, lastCommand } = spyRegistry(undefined)
    app = await makeApp(registry)
    await rpc(app, INIT_BODY)
    await rpc(
      app,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bash', arguments: { command: 'ls' } } },
      `?k=${SECRET}&agent=a1&cwd=${encodeURIComponent('/repos/p 1')}`
    )
    expect(lastCommand()).toBe(`cd -- '/repos/p 1' && ls`)
  })

  it('cwd на win32-машине нормализует бэкслеши перед cd -- (иначе ломается в git-bash)', async () => {
    const { registry, lastCommand } = spyRegistry('win32')
    app = await makeApp(registry)
    await rpc(app, INIT_BODY)
    await rpc(
      app,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bash', arguments: { command: 'ls' } } },
      `?k=${SECRET}&agent=a1&cwd=${encodeURIComponent('C:\\Users\\dev\\project')}`
    )
    expect(lastCommand()).toBe(`cd -- 'C:/Users/dev/project' && ls`)
  })

  it('неверный секрет k → 403', async () => {
    app = await makeApp(stubRegistry({ exitCode: 0, output: '', timedOut: false }))
    const res = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'initialize' }, '?k=wrong&agent=a1')
    expect(res.statusCode).toBe(403)
  })

  it('initialize → tools/list показывает bash', async () => {
    app = await makeApp(stubRegistry({ exitCode: 0, output: '', timedOut: false }))
    const init = await rpc(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' }
      }
    })
    expect(init.statusCode).toBe(200)

    const list = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const body = list.json() as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((t) => t.name)).toContain('bash')
  })

  it('tools/call bash → результат из реестра с кодом выхода', async () => {
    app = await makeApp(stubRegistry({ exitCode: 0, output: 'Filesystem 50%', timedOut: false }))
    await rpc(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
    })
    const call = await rpc(app, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'df -h' } }
    })
    const body = call.json() as {
      result: { content: Array<{ text: string }>; isError?: boolean }
    }
    expect(body.result.content[0].text).toContain('Filesystem 50%')
    expect(body.result.content[0].text).toContain('exit code: 0')
    expect(body.result.isError).toBeFalsy()
  })

  it('офлайн-агент (exec бросает) → isError с текстом ошибки', async () => {
    app = await makeApp(stubRegistry(new Error('Машина не в сети')))
    await rpc(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
    })
    const call = await rpc(app, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'ls' } }
    })
    const body = call.json() as {
      result: { content: Array<{ text: string }>; isError?: boolean }
    }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('не в сети')
  })

  it('ro=1 (фаза плана): чтение проходит, изменяющая команда отклоняется без exec', async () => {
    let execCalls = 0
    const registry = {
      exec: async () => {
        execCalls++
        return { exitCode: 0, output: 'ok', timedOut: false }
      },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const ro = `?k=${SECRET}&agent=a1&ro=1`
    await rpc(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }
    }, ro)

    const read = await rpc(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'git log --oneline -5' } }
    }, ro)
    expect((read.json() as { result: { isError?: boolean } }).result.isError).toBeFalsy()
    expect(execCalls).toBe(1)

    const write = await rpc(app, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'rm -rf src' } }
    }, ro)
    const body = write.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('режим «План»')
    expect(execCalls).toBe(1)
  })

  it('регресс: нормальный tools/call не отменяет команду (close ответа, не запроса)', async () => {
    // Реестр с задержкой: запоминает, сработал ли signal.abort к моменту резолва.
    // Баг был в том, что отмена висела на close запроса и срабатывала до ответа —
    // тогда команда отменялась мгновенно.
    let abortedAtResolve: boolean | null = null
    const registry = {
      exec: (_a: string, command: string, _t: number, signal?: AbortSignal) =>
        new Promise<ExecResult>((resolve) => {
          setTimeout(() => {
            abortedAtResolve = signal?.aborted ?? false
            resolve({ exitCode: 0, output: `OUT:${command}`, timedOut: false })
          }, 60)
        }),
      cancelAll: () => {}
    } as unknown as AgentRegistry

    const server = Fastify({ logger: false })
    registerRemoteBashMcp(server, registry, SECRET)
    await server.listen({ port: 0, host: '127.0.0.1' })
    const addr = server.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp/remote-bash?k=${SECRET}&agent=a1`, {
        method: 'POST',
        headers: MCP_HEADERS,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'bash', arguments: { command: 'hostname' } }
        })
      })
      const data = (await res.json()) as { result: { content: Array<{ text: string }> } }
      expect(data.result.content[0].text).toContain('OUT:hostname')
      expect(data.result.content[0].text).not.toContain('отменена')
      expect(abortedAtResolve).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('после ответа не остаётся отложенных исключений (тело читает транспорт, не Fastify)', async () => {
    // Если тело запроса вычитает Fastify, hono/node-server внутри MCP-SDK через
    // 500 мс «дренирует» соединение и дёргает socket.destroySoon() — на сокете
    // от app.inject такого метода нет, и таймер валит процесс необработанным
    // исключением уже после того, как все тесты позеленели.
    app = await makeApp(stubRegistry({ exitCode: 0, output: '', timedOut: false }))
    const res = await rpc(app, INIT_BODY)
    expect(res.statusCode).toBe(200)

    const caught: Error[] = []
    const onUncaught = (err: Error): void => { caught.push(err) }
    process.on('uncaughtException', onUncaught)
    try {
      await new Promise((r) => setTimeout(r, 800))
    } finally {
      process.off('uncaughtException', onUncaught)
    }
    expect(caught.map((e) => e.message)).toEqual([])
  })
})
