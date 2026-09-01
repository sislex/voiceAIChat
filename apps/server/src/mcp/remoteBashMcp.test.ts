import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { ciToolOutputLimits, isTrimmedToolOutput, trimmedToolOutputOriginalChars } from '@voicechat/shared'
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

  it('чистое чтение файла отклоняется до exec и возвращает готовый вызов read', async () => {
    const { registry, lastCommand } = spyRegistry(undefined)
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=${encodeURIComponent('/repos/task')}`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'bash', arguments: { command: "sed -n '10,20p' apps/server/src/server.ts" } }
    }, query)
    const result = (call.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('read {"path":"apps/server/src/server.ts","offset":10,"limit":11}')
    expect(lastCommand()).toBe('') // до машины команда не дошла
  })

  it('команда, где чтение — часть работы, выполняется как раньше', async () => {
    const { registry, lastCommand } = spyRegistry(undefined)
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=${encodeURIComponent('/repos/task')}`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'npm test 2>&1 | tail -50' } }
    }, query)
    expect((call.json() as { result: { isError?: boolean } }).result.isError).toBeFalsy()
    expect(lastCommand()).toContain('npm test 2>&1 | tail -50')
  })

  it('ro=1 (фаза плана): гейт чтения работает, исследование bash — нет', async () => {
    const { registry, lastCommand } = spyRegistry(undefined)
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=${encodeURIComponent('/repos/task')}&ro=1`
    await rpc(app, INIT_BODY, query)
    const read = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'cat AGENTS.md' } }
    }, query)
    const text = (read.json() as { result: { content: Array<{ text: string }> } }).result.content[0].text
    expect(text).toContain('read {"path":"AGENTS.md"}')
    expect(lastCommand()).toBe('')

    const explore = await rpc(app, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'git log --oneline -5' } }
    }, query)
    expect((explore.json() as { result: { isError?: boolean } }).result.isError).toBeFalsy()
    expect(lastCommand()).toContain('git log --oneline -5')
  })

  it('tools/list показывает bash и файловые инструменты', async () => {
    app = await makeApp(stubRegistry({ exitCode: 0, output: '', timedOut: false }))
    await rpc(app, INIT_BODY)
    const list = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const names = (list.json() as { result: { tools: Array<{ name: string }> } })
      .result.tools.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(['bash', 'read', 'image', 'grep', 'edit']))
  })

  it('read читает через fsRead и отдаёт только запрошенное окно с номерами строк', async () => {
    let readPath = ''
    const registry = {
      fsRead: async (_agentId: string, path: string) => {
        readPath = path
        return { root: '/repos', cwd: '', dataBase64: Buffer.from('one\ntwo\nthree\nfour\n').toString('base64') }
      },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    await rpc(app, INIT_BODY, `?k=${SECRET}&agent=a1&cwd=/repos/task`)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'read', arguments: { path: 'src/a.ts', offset: 2, limit: 2 } }
    }, `?k=${SECRET}&agent=a1&cwd=/repos/task`)
    const body = call.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    expect(body.result.isError).toBeFalsy()
    expect(body.result.content[0].text).toBe('2\ttwo\n3\tthree\n\nПоказаны строки 2–3 из 4.')
    expect(body.result.content[0].text).not.toContain('one')
    expect(readPath).toBe('/repos/task/src/a.ts')
  })

  it('grep ограничивает число совпадений и длину строки', async () => {
    let command = ''
    const registry = {
      exec: async (_agentId: string, value: string) => {
        command = value
        return { exitCode: 0, output: `a.ts:1:first\na.ts:2:${'x'.repeat(2_100)}\na.ts:3:third\n`, timedOut: false }
      },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'grep', arguments: { pattern: 'needle', path: 'src', glob: '*.ts', maxMatches: 2 } }
    }, query)
    const text = (call.json() as { result: { content: Array<{ text: string }> } }).result.content[0].text
    expect(text).toContain('a.ts:1:first')
    expect(text).toContain('Показаны первые 2 из 3 совпадений.')
    expect(text).not.toContain('a.ts:3:third')
    expect(text.split('\n')[1].length).toBe(2_000)
    expect(command).toContain("grep -rn --binary-files=without-match --include='*.ts'")
    expect(command).toContain("'/repos/task/src'")
  })

  it('edit требует ровно одно совпадение и пишет только изменённый файл', async () => {
    let source = 'before OLD after'
    let written = ''
    const registry = {
      fsRead: async () => ({ root: '/repos', cwd: '', dataBase64: Buffer.from(source).toString('base64') }),
      fsWrite: async (_agentId: string, _path: string, dataBase64: string) => {
        written = Buffer.from(dataBase64, 'base64').toString('utf8')
        return { root: '/repos', cwd: '' }
      },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
    await rpc(app, INIT_BODY, query)

    source = 'without target'
    const missing = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'edit', arguments: { path: 'a.ts', oldString: 'OLD', newString: 'NEW' } }
    }, query)
    expect((missing.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result)
      .toMatchObject({ isError: true, content: [{ text: expect.stringContaining('не найден') }] })

    source = 'OLD and OLD'
    const many = await rpc(app, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'edit', arguments: { path: 'a.ts', oldString: 'OLD', newString: 'NEW' } }
    }, query)
    expect((many.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result)
      .toMatchObject({ isError: true, content: [{ text: expect.stringContaining('2 вхождений') }] })

    source = 'before OLD after'
    const ok = await rpc(app, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'edit', arguments: { path: 'a.ts', oldString: 'OLD', newString: 'NEW' } }
    }, query)
    expect((ok.json() as { result: { isError?: boolean } }).result.isError).toBeFalsy()
    expect(written).toBe('before NEW after')
  })

  it('абсолютный путь внутри cwd принимается: модель называет пути так же, как их видит', async () => {
    let readPath = ''
    const registry = {
      fsRead: async (_agentId: string, path: string) => {
        readPath = path
        return { root: '/repos', cwd: '', dataBase64: Buffer.from('one\n').toString('base64') }
      },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'read', arguments: { path: '/repos/task/src/a.ts' } }
    }, query)
    expect((call.json() as { result: { isError?: boolean } }).result.isError).toBeFalsy()
    expect(readPath).toBe('/repos/task/src/a.ts')
  })

  it('абсолютный путь вне cwd отклоняется, и в отказе назван сам cwd', async () => {
    let calls = 0
    const registry = {
      fsRead: async () => { calls++; throw new Error('unexpected') },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'read', arguments: { path: '/repos/other/a.ts' } }
    }, query)
    const result = (call.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('за пределами')
    expect(result.content[0].text).toContain('/repos/task')
    expect(calls).toBe(0)
  })

  it('соседний каталог с общим префиксом за cwd не считается: /repos/taskX отклоняется', async () => {
    let calls = 0
    const registry = {
      fsRead: async () => { calls++; throw new Error('unexpected') },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'read', arguments: { path: '/repos/taskX/a.ts' } }
    }, query)
    expect((call.json() as { result: { isError: boolean } }).result.isError).toBe(true)
    expect(calls).toBe(0)
  })

  it('win32: абсолютный путь внутри cwd принимается без учёта регистра и слэшей', async () => {
    let readPath = ''
    const registry = {
      fsRead: async (_agentId: string, path: string) => {
        readPath = path
        return { root: 'C:/repos', cwd: '', dataBase64: Buffer.from('one\n').toString('base64') }
      },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=${encodeURIComponent('C:/repos/task')}`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'read', arguments: { path: 'c:\\Repos\\task\\src\\a.ts' } }
    }, query)
    expect((call.json() as { result: { isError?: boolean } }).result.isError).toBeFalsy()
    expect(readPath).toBe('C:/repos/task/src/a.ts')
  })

  it('абсолютный путь с .. внутри cwd отклоняется', async () => {
    let calls = 0
    const registry = {
      fsRead: async () => { calls++; throw new Error('unexpected') },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'read', arguments: { path: '/repos/task/../other/a.ts' } }
    }, query)
    expect((call.json() as { result: { isError: boolean } }).result.isError).toBe(true)
    expect(calls).toBe(0)
  })

  it('файловый путь за пределами cwd отклоняется до обращения к реестру', async () => {
    let calls = 0
    const registry = {
      fsRead: async () => { calls++; throw new Error('unexpected') },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'read', arguments: { path: '../secret' } }
    }, query)
    const result = (call.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('за пределами')
    expect(calls).toBe(0)
  })

  it.each(['Машина не в сети', 'Агент устарел. Нужна ≥ v1'])(
    'read сохраняет ошибку реестра: %s',
    async (message) => {
      const registry = {
        fsRead: async () => { throw new Error(message) },
        cancelAll: () => {}
      } as unknown as AgentRegistry
      app = await makeApp(registry)
      const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
      await rpc(app, INIT_BODY, query)
      const call = await rpc(app, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'read', arguments: { path: 'a.ts' } }
      }, query)
      const result = (call.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe(message)
    }
  )

  it('ro=1 отклоняет edit до чтения файла', async () => {
    let reads = 0
    const registry = {
      fsRead: async () => { reads++; throw new Error('unexpected') },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeApp(registry)
    const query = `?k=${SECRET}&agent=a1&cwd=/repos/task&ro=1`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'edit', arguments: { path: 'a.ts', oldString: 'a', newString: 'b' } }
    }, query)
    const result = (call.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('режим «План»')
    expect(reads).toBe(0)
  })

  // Сжатие контекста хода: каждый вызов инструмента — новый запрос ко ВСЕМУ
  // накопленному контексту, поэтому один толстый ответ оплачивается столько раз,
  // сколько запросов осталось до конца хода. Ответы капнуты настройкой.
  describe('лимиты ответов (сжатие контекста хода)', () => {
    it('длинный вывод bash обрезается с пометкой, хвост и код выхода остаются', async () => {
      const output = `ШАПКА npm ci\n${'x'.repeat(60_000)}\nnpm ERR! код 1 — вот причина`
      app = await makeApp(stubRegistry({ exitCode: 1, output, timedOut: false }))
      await rpc(app, INIT_BODY)
      const call = await rpc(app, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'bash', arguments: { command: 'npm ci' } }
      })
      const result = (call.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result
      const text = result.content[0].text
      expect(result.isError).toBe(true)
      // Модель обязана знать, что данные неполные, и чем их добрать.
      expect(isTrimmedToolOutput(text)).toBe(true)
      expect(text).toContain('Данные неполные')
      expect(trimmedToolOutputOriginalChars(text)).toBe(output.length)
      // Хвост важнее головы: причина падения и код выхода на месте — fix-loop
      // должен видеть, из-за чего упало.
      expect(text).toContain('npm ERR! код 1 — вот причина')
      expect(text).toContain('[exit code: 1]')
      expect(text).toContain('ШАПКА npm ci')
      expect(text.length).toBeLessThan(output.length / 2)
    })

    it('короткий вывод bash не обрезается и пометки не несёт', async () => {
      app = await makeApp(stubRegistry({ exitCode: 0, output: 'готово', timedOut: false }))
      await rpc(app, INIT_BODY)
      const call = await rpc(app, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'bash', arguments: { command: 'ls' } }
      })
      const text = (call.json() as { result: { content: Array<{ text: string }> } }).result.content[0].text
      expect(text).toBe('готово\n[exit code: 0]')
      expect(isTrimmedToolOutput(text)).toBe(false)
    })

    it('лимиты берутся из настроек на каждый запрос и живут в описаниях инструментов', async () => {
      let bashChars = 2_000
      const app2 = Fastify({ logger: false })
      registerRemoteBashMcp(app2, stubRegistry({ exitCode: 0, output: 'y'.repeat(5_000), timedOut: false }), SECRET,
        () => ciToolOutputLimits({ bashOutputLimitChars: bashChars, readWindowMaxLines: 50, grepMatchLimit: 7 }))
      await app2.ready()
      app = app2
      await rpc(app, INIT_BODY)
      const list = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const tools = (list.json() as { result: { tools: Array<{ name: string; description: string }> } }).result.tools
      expect(tools.find((t) => t.name === 'bash')!.description).toContain('2000')
      expect(tools.find((t) => t.name === 'read')!.description).toContain('50 строк')
      expect(tools.find((t) => t.name === 'grep')!.description).toContain('(7)')

      const tight = await rpc(app, {
        jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bash', arguments: { command: 'ls' } }
      })
      expect(isTrimmedToolOutput((tight.json() as { result: { content: Array<{ text: string }> } }).result.content[0].text)).toBe(true)

      // Настройку поменяли без перезапуска сервера — следующий вызов уже с новым лимитом.
      bashChars = 400_000
      const loose = await rpc(app, {
        jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bash', arguments: { command: 'ls' } }
      })
      expect(isTrimmedToolOutput((loose.json() as { result: { content: Array<{ text: string }> } }).result.content[0].text)).toBe(false)
    })

    it('сломанный источник настроек не роняет вызов: работают дефолты', async () => {
      const app2 = Fastify({ logger: false })
      registerRemoteBashMcp(app2, stubRegistry({ exitCode: 0, output: 'ок', timedOut: false }), SECRET, () => {
        throw new Error('БД недоступна')
      })
      await app2.ready()
      app = app2
      await rpc(app, INIT_BODY)
      const call = await rpc(app, {
        jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bash', arguments: { command: 'ls' } }
      })
      expect((call.json() as { result: { content: Array<{ text: string }> } }).result.content[0].text).toBe('ок\n[exit code: 0]')
    })

    it('окно read зажимается по строкам и по объёму — с явной пометкой', async () => {
      // Строки длинные намеренно: окно упирается в лимит объёма раньше, чем в
      // лимит строк — именно так в контекст уезжал файл целиком.
      const file = Array.from({ length: 500 }, (_, i) => `строка ${i + 1}: ${'я'.repeat(60)}`).join('\n')
      const registry = {
        fsRead: async () => ({ root: '/repos', cwd: '', dataBase64: Buffer.from(file).toString('base64') }),
        cancelAll: () => {}
      } as unknown as AgentRegistry
      const app2 = Fastify({ logger: false })
      registerRemoteBashMcp(app2, registry, SECRET, () => ciToolOutputLimits({ readWindowMaxLines: 60, readOutputLimitChars: 1_000 }))
      await app2.ready()
      app = app2
      const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
      await rpc(app, INIT_BODY, query)
      // Просить больше максимума нельзя: схема инструмента лимит уже знает.
      const tooMany = await rpc(app, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'read', arguments: { path: 'a.ts', limit: 500 } }
      }, query)
      expect((tooMany.json() as { result?: { isError?: boolean }; error?: unknown }).result?.isError ?? true).toBeTruthy()
      // Разрешённое окно упирается в лимит объёма и говорит об этом.
      const call = await rpc(app, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'read', arguments: { path: 'a.ts', limit: 60 } }
      }, query)
      const text = (call.json() as { result: { content: Array<{ text: string }> } }).result.content[0].text
      expect(text).toContain('строка 1')
      expect(text).toContain('из 500.')
      expect(isTrimmedToolOutput(text)).toBe(true)
      expect(text).toContain('читай дальше со смещением')
      expect(text.length).toBeLessThan(1_400)
    })

    it('grep режется по объёму на границе совпадения, а не посреди строки', async () => {
      const line = (n: number): string => `a.ts:${n}:${'y'.repeat(400)}`
      const output = `${Array.from({ length: 50 }, (_, i) => line(i + 1)).join('\n')}\n`
      const registry = {
        exec: async () => ({ exitCode: 0, output, timedOut: false }),
        cancelAll: () => {}
      } as unknown as AgentRegistry
      const app2 = Fastify({ logger: false })
      registerRemoteBashMcp(app2, registry, SECRET, () => ciToolOutputLimits({ grepOutputLimitChars: 2_000 }))
      await app2.ready()
      app = app2
      const query = `?k=${SECRET}&agent=a1&cwd=/repos/task`
      await rpc(app, INIT_BODY, query)
      const call = await rpc(app, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'grep', arguments: { pattern: 'y' } }
      }, query)
      const text = (call.json() as { result: { content: Array<{ text: string }> } }).result.content[0].text
      expect(isTrimmedToolOutput(text)).toBe(true)
      expect(text).toContain('из 50 совпадений')
      // Каждая показанная строка — целая: обрубленный путь модель прочтёт как настоящий.
      for (const shown of text.split('\n').filter((l) => l.startsWith('a.ts:'))) {
        expect(shown.endsWith('y')).toBe(true)
      }
      expect(text.length).toBeLessThan(3_000)
    })
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

describe('remoteBashMcp: машины проекта (query project)', () => {
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

  const MACHINES = [
    { agentId: 'a1', name: 'Мак', path: '' },
    { agentId: 'a2', name: 'Сервер', path: '/srv/proj' },
    { agentId: 'a3', name: 'Пустая', path: '' }
  ]

  /** Реестр-шпион: помнит агента и команду/путь каждого вызова; a3 — офлайн. */
  function spy(): {
    registry: AgentRegistry
    lastExec: () => { agentId: string; command: string }
    lastFs: () => { agentId: string; path: string; written: string | null }
  } {
    let exec = { agentId: '', command: '' }
    let fs = { agentId: '', path: '', written: null as string | null }
    const registry = {
      exec: async (agentId: string, command: string) => {
        exec = { agentId, command }
        return { exitCode: 0, output: 'ок', timedOut: false }
      },
      fsRead: async (agentId: string, path: string) => {
        fs = { agentId, path, written: fs.written }
        return { root: '/', cwd: '', dataBase64: Buffer.from('старый текст\n').toString('base64') }
      },
      fsWrite: async (agentId: string, path: string, dataBase64: string) => {
        fs = { agentId, path, written: Buffer.from(dataBase64, 'base64').toString('utf8') }
        return { root: '/', cwd: '' }
      },
      isOnline: (agentId: string) => agentId !== 'a3',
      platformOf: () => undefined,
      cancelAll: () => {}
    } as unknown as AgentRegistry
    return { registry, lastExec: () => exec, lastFs: () => fs }
  }

  async function makeProjectApp(registry: AgentRegistry): Promise<FastifyInstance> {
    const server = Fastify({ logger: false })
    registerRemoteBashMcp(server, registry, SECRET, undefined, (projectId) =>
      projectId === 'p1' ? MACHINES : []
    )
    await server.ready()
    return server
  }

  const Q = `?k=${SECRET}&agent=a1&cwd=${encodeURIComponent('/repos/task')}&project=p1`

  it('с project в query появляется инструмент machines и параметр machine; без него — нет', async () => {
    app = await makeProjectApp(spy().registry)
    await rpc(app, INIT_BODY, Q)
    const withProject = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, Q)
    const tools = (withProject.json() as {
      result: { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> }
    }).result.tools
    expect(tools.map((t) => t.name)).toContain('machines')
    for (const name of ['bash', 'read', 'image', 'grep', 'edit']) {
      expect(tools.find((t) => t.name === name)?.inputSchema.properties).toHaveProperty('machine')
    }

    const bare = `?k=${SECRET}&agent=a1&cwd=${encodeURIComponent('/repos/task')}`
    await rpc(app, INIT_BODY, bare)
    const withoutProject = await rpc(app, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, bare)
    const bareTools = (withoutProject.json() as {
      result: { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> }
    }).result.tools
    expect(bareTools.map((t) => t.name)).not.toContain('machines')
    expect(bareTools.find((t) => t.name === 'bash')?.inputSchema.properties).not.toHaveProperty('machine')
  })

  it('machines перечисляет машины с онлайн-статусом, папкой и пометкой выбранной', async () => {
    app = await makeProjectApp(spy().registry)
    await rpc(app, INIT_BODY, Q)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'machines', arguments: {} }
    }, Q)
    const text = (call.json() as { result: { content: Array<{ text: string }> } }).result.content[0].text
    expect(text).toContain('«Мак» (id a1) — в сети; выбранная машина этого хода')
    expect(text).toContain('«Сервер» (id a2) — в сети; папка проекта: /srv/proj')
    expect(text).toContain('«Пустая» (id a3) — не в сети')
    expect(text).toContain('папка проекта: не настроена')
    expect(text).toContain('рабочая директория: /repos/task')
  })

  it('bash с machine выполняется на названной машине в её папке проекта', async () => {
    const { registry, lastExec } = spy()
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)
    await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'ls', machine: 'Сервер' } }
    }, Q)
    expect(lastExec()).toEqual({ agentId: 'a2', command: `cd -- '/srv/proj' && ls` })
  })

  it('bash без machine идёт на выбранную машину с cwd хода (прежнее поведение)', async () => {
    const { registry, lastExec } = spy()
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)
    await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'ls' } }
    }, Q)
    expect(lastExec()).toEqual({ agentId: 'a1', command: `cd -- '/repos/task' && ls` })
  })

  it('выбранная машина, названная по имени, работает в cwd хода даже без папки проекта', async () => {
    const { registry, lastExec } = spy()
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)
    await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'ls', machine: 'Мак' } }
    }, Q)
    expect(lastExec()).toEqual({ agentId: 'a1', command: `cd -- '/repos/task' && ls` })
  })

  it('неизвестная машина отклоняется до exec с перечнем доступных', async () => {
    const { registry, lastExec } = spy()
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'ls', machine: 'Чужая' } }
    }, Q)
    const body = call.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('«Чужая» не найдена')
    expect(body.result.content[0].text).toContain('«Сервер»')
    expect(lastExec().agentId).toBe('')
  })

  it('машина без настроенной папки проекта отклоняется до обращения к ней', async () => {
    const { registry, lastExec } = spy()
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'ls', machine: 'Пустая' } }
    }, Q)
    const body = call.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('не настроена папка проекта')
    expect(lastExec().agentId).toBe('')
  })

  it('read и edit с machine ходят в файлы названной машины внутри её папки проекта', async () => {
    const { registry, lastFs } = spy()
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)

    await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'read', arguments: { path: 'src/a.ts', machine: 'Сервер' } }
    }, Q)
    expect(lastFs().agentId).toBe('a2')
    expect(lastFs().path).toBe('/srv/proj/src/a.ts')

    await rpc(app, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'edit', arguments: { path: 'src/a.ts', oldString: 'старый', newString: 'новый', machine: 'Сервер' } }
    }, Q)
    expect(lastFs().agentId).toBe('a2')
    expect(lastFs().written).toBe('новый текст\n')
  })

  it('grep с machine ищет в папке проекта названной машины', async () => {
    const { registry, lastExec } = spy()
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)
    await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'grep', arguments: { pattern: 'needle', machine: 'Сервер' } }
    }, Q)
    expect(lastExec().agentId).toBe('a2')
    expect(lastExec().command).toContain(`'/srv/proj'`)
  })

  it('ro=1: правка отклоняется и с параметром machine', async () => {
    const { registry, lastFs } = spy()
    app = await makeProjectApp(registry)
    const ro = `${Q}&ro=1`
    await rpc(app, INIT_BODY, ro)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'edit', arguments: { path: 'a.ts', oldString: 'x', newString: 'y', machine: 'Сервер' } }
    }, ro)
    const body = call.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('режим «План»')
    expect(lastFs().agentId).toBe('')
  })

  it('image: JPEG/PNG возвращаются отдельным типизированным блоком без base64 в тексте', async () => {
    for (const [path, mimeType] of [['1.jpg', 'image/jpeg'], ['2.png', 'image/png']] as const) {
      const bytes = (mimeType === 'image/jpeg'
        ? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
        : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])).toString('base64')
      const registry = {
        fsRead: async (_agentId: string, actual: string) => {
          if (actual !== `/repos/task/${path}`) throw new Error('ENOENT')
          return { root: '/', cwd: '/repos/task', dataBase64: bytes }
        },
        cancelAll: () => {}
      } as unknown as AgentRegistry
      app = await makeProjectApp(registry)
      await rpc(app, INIT_BODY, Q)
      const call = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'image', arguments: { path } } }, Q)
      const content = (call.json() as { result: { content: Array<{ type: string; data?: string; mimeType?: string; text?: string }> } }).result.content
      expect(content[0]).toMatchObject({ type: 'image', data: bytes, mimeType })
      expect(content.filter((item) => item.type === 'text').map((item) => item.text).join('')).not.toContain(bytes)
      await app.close()
    }
    app = Fastify()
  })

  it('image: вложение с тем же именем приоритетнее cwd и папки проекта', async () => {
    const attachmentBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]).toString('base64')
    let reads = 0
    const registry = {
      fsRead: async () => { reads++; return { root: '/', cwd: '', dataBase64: Buffer.from('project').toString('base64') } },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    const server = Fastify({ logger: false })
    registerRemoteBashMcp(server, registry, SECRET, undefined, () => [
      { agentId: 'a1', name: 'Мак', path: '/project' }
    ], (token) => token === 'turn-files' ? [{ path: '/uploads/1.jpg', name: '1.jpg', dataBase64: attachmentBytes }] : undefined)
    await server.ready(); app = server
    const query = `${Q}&files=turn-files`
    await rpc(app, INIT_BODY, query)
    const call = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'image', arguments: { path: '1.jpg' } } }, query)
    const content = (call.json() as { result: { content: Array<{ type: string; data?: string }> } }).result.content
    expect(content[0]).toMatchObject({ type: 'image', data: attachmentBytes })
    expect(reads).toBe(0)
  })

  it('image различает отсутствующий файл и найденный неподдерживаемый формат', async () => {
    const registry = {
      fsRead: async (_agentId: string, path: string) => {
        if (path.endsWith('/diagram.tiff')) return { root: '/', cwd: '', dataBase64: Buffer.from('tiff').toString('base64') }
        throw new Error('ENOENT')
      },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)
    const invoke = (path: string, id: number) => rpc(app, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'image', arguments: { path } } }, Q)
    const unsupported = (await invoke('diagram.tiff', 2)).json() as { result: { content: Array<{ text: string }>; isError: boolean } }
    expect(unsupported.result.isError).toBe(true)
    expect(unsupported.result.content[0].text).toContain('найден, но формат')
    const missing = (await invoke('missing.jpg', 3)).json() as { result: { content: Array<{ text: string }>; isError: boolean } }
    expect(missing.result.isError).toBe(true)
    expect(missing.result.content[0].text).toContain('не найден')
    expect(missing.result.content[0].text).not.toContain('формат')
  })

  it('image: JPEG около 5 MiB проходит MCP целиком', async () => {
    const jpeg = Buffer.alloc(5 * 1024 * 1024, 0x5a)
    jpeg.set([0xff, 0xd8, 0xff, 0xe0])
    const bytes = jpeg.toString('base64')
    const registry = {
      fsRead: async () => ({ root: '/', cwd: '/repos/task', dataBase64: bytes }),
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)

    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'image', arguments: { path: 'large.jpg' } }
    }, Q)
    const content = (call.json() as {
      result: { content: Array<{ type: string; data?: string; mimeType?: string; text?: string }> }
    }).result.content
    expect(content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
    expect(content[0].data).toHaveLength(bytes.length)
    expect(content[0].data).toBe(bytes)
    expect(content.filter((item) => item.type === 'text').map((item) => item.text).join('')).not.toContain(bytes.slice(0, 100))
  })

  it.each([
    ['таймаут', 'Машина не ответила на файловую операцию за 30 с'],
    ['обрыв соединения', 'Машина отключилась'],
    ['ошибка агента', 'EACCES: permission denied']
  ])('image: %s агента не маскируется как отсутствие файла', async (_case, message) => {
    const registry = {
      fsRead: async () => { throw new Error(message) },
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)

    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'image', arguments: { path: 'existing.jpg' } }
    }, Q)
    const result = (call.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(message)
    expect(result.content[0].text).not.toContain('не найден')
  })

  it('image: неполный fs.result агента диагностируется отдельно', async () => {
    const registry = {
      fsRead: async () => ({ root: '/', cwd: '/repos/task' }),
      cancelAll: () => {}
    } as unknown as AgentRegistry
    app = await makeProjectApp(registry)
    await rpc(app, INIT_BODY, Q)

    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'image', arguments: { path: 'broken.jpg' } }
    }, Q)
    const result = (call.json() as { result: { content: Array<{ text: string }>; isError: boolean } }).result
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('неполный ответ')
    expect(result.content[0].text).not.toContain('не найден')
  })

  it('сломанный резолвер машин не роняет ход: мост работает по-старому', async () => {
    const { registry, lastExec } = spy()
    const server = Fastify({ logger: false })
    registerRemoteBashMcp(server, registry, SECRET, undefined, () => {
      throw new Error('база недоступна')
    })
    await server.ready()
    app = server
    await rpc(app, INIT_BODY, Q)
    const call = await rpc(app, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'bash', arguments: { command: 'ls' } }
    }, Q)
    expect((call.json() as { result: { isError?: boolean } }).result.isError).toBeFalsy()
    expect(lastExec()).toEqual({ agentId: 'a1', command: `cd -- '/repos/task' && ls` })
  })
})
