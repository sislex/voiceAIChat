import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerRemoteBashMcp } from './remoteBashMcp'
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

describe('remoteBashMcp', () => {
  let app: FastifyInstance
  afterEach(async () => {
    await app.close()
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
})
