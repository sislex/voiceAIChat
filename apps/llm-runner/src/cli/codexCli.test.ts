import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { CodexCli, type SpawnFn } from './codexCli'
import type { LlmStreamHandlers } from '@voicechat/shared'

function fakeChild(): {
  child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void }
  stdin: PassThrough
  stdout: PassThrough
} {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: vi.fn() })
  return { child, stdin, stdout }
}

function makeHandlers(): LlmStreamHandlers & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { delta: [], session: [], done: [], error: [] }
  return {
    calls,
    onDelta: (t) => calls.delta.push(t),
    onSession: (s) => calls.session.push(s),
    onDone: (t) => calls.done.push(t),
    onError: (m) => calls.error.push(m)
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))
const argsOf = (spawn: unknown): string[] =>
  (spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]

describe('CodexCli', () => {
  it('базовые args: prompt передаётся через stdin, argv заканчивается на -', async () => {
    const { child, stdin } = fakeChild()
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send({ prompt: 'привет', sessionId: null, model: 'gpt-5-codex' }, makeHandlers())
    const args = argsOf(spawn)
    expect(args.slice(0, 3)).toEqual(['exec', '--json', '--skip-git-repo-check'])
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-5-codex')
    expect(args[args.length - 1]).toBe('-')
    await tick()
    expect(input).toBe('привет')
  })

  it('пустая модель → без -m; permissionMode=plan → sandbox read-only', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send(
      { prompt: 'x', sessionId: null, model: '', permissionMode: 'plan' },
      makeHandlers()
    )
    const args = argsOf(spawn)
    expect(args).not.toContain('-m')
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
  })

  it('sessionId → resume <id>', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send({ prompt: 'x', sessionId: 'thread-7', model: '' }, makeHandlers())
    const args = argsOf(spawn)
    expect(args[args.indexOf('resume') + 1]).toBe('thread-7')
  })

  it('remote → -c mcp_servers.remote.url + инструкция в stdin', async () => {
    const { child, stdin } = fakeChild()
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send(
      {
        prompt: 'сделай что-то',
        sessionId: null,
        model: '',
        remote: { mcpUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=s&agent=a1', agentName: 'Мак' }
      },
      makeHandlers()
    )
    const args = argsOf(spawn)
    expect(args.some((a) => a.startsWith('mcp_servers.remote.url='))).toBe(true)
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox')
    await tick()
    expect(input).toContain('remote')
    expect(input).toContain('Мак')
    expect(input).toContain('сделай что-то')
    // Файловые инструменты сервера: без упоминания модель знает только bash и
    // читает файлы `cat`, а правит heredoc'ом — ради этого их и заводили.
    expect(input).toContain('read')
    expect(input).toContain('grep')
    expect(input).toContain('edit')
    expect(input).toContain('remote:image')
    expect(input).toContain('вложение чата → cwd хода → директория проекта → абсолютный путь')
    expect(input).toContain('формат не поддерживается')
    expect(input).toContain('Независимые чтения и поиски объединяй')
  })

  it('регистрирует несколько task Make-источников независимо', async () => {
    const { child, stdin } = fakeChild()
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send({
      prompt: 'x', sessionId: null, model: '',
      makeSources: [
        { name: 'make_design_1', conversationId: 'c1', paths: [''], mcpUrl: 'http://m/1' },
        { name: 'make_design_2', conversationId: 'c2', paths: ['src/App.tsx'], mcpUrl: 'http://m/2' }
      ]
    }, makeHandlers())
    const args = argsOf(spawn)
    expect(args).toContain('mcp_servers.make_design_1.url="http://m/1"')
    expect(args).toContain('mcp_servers.make_design_2.url="http://m/2"')
    await tick()
    expect(input).toContain('проект целиком')
    expect(input).toContain('src/App.tsx')
  })

  it('projectMachines: другие машины проекта и инструмент machines названы в промпте', async () => {
    const { child, stdin } = fakeChild()
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send(
      {
        prompt: 'сделай что-то',
        sessionId: null,
        model: '',
        remote: {
          mcpUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=s&agent=a1&project=p1',
          agentName: 'Мак',
          projectMachines: ['Сервер']
        }
      },
      makeHandlers()
    )
    await tick()
    expect(input).toContain('«Сервер»')
    expect(input).toContain('remote:machines')
    expect(input).toContain('параметром machine')
  })

  it('readOnlyRemote: план подключает remote MCP с bypass, а промпт сохраняет запрет правок', async () => {
    const { child, stdin } = fakeChild()
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send(
      {
        prompt: 'составь план', sessionId: null, model: '', permissionMode: 'default', readOnlyRemote: true,
        remote: { mcpUrl: 'http://127.0.0.1/mcp?ro=1', agentName: 'Ноутбук' }
      },
      makeHandlers()
    )
    const args = argsOf(spawn)
    expect(args.some((arg) => arg.startsWith('mcp_servers.remote.url=') && arg.includes('ro=1'))).toBe(true)
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox')
    await tick()
    expect(input).toContain('Режим «План»: только read/grep')
  })

  it('kbMcpUrl: сервер kb подключается и в режиме «План» (БЗ read-only)', async () => {
    const { child, stdin } = fakeChild()
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send(
      { prompt: 'x', sessionId: null, model: '', permissionMode: 'plan', kbMcpUrl: 'http://127.0.0.1:8787/mcp/kb?k=s&turn=t1', kbMode: 'auto' },
      makeHandlers()
    )
    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    expect(args.some((a) => a.startsWith('mcp_servers.kb.url=') && a.includes('turn=t1'))).toBe(true)
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
    // Хинт уходит в промпт (stdin), а не флагом: у codex нет append-system-prompt.
    await tick()
    expect(input).toContain('mcp__kb__search')
  })

  it('previewMcpUrl: сервер browser подключается, хинт про превью уходит в промпт', async () => {
    const { child, stdin } = fakeChild()
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send(
      { prompt: 'x', sessionId: null, model: '', previewMcpUrl: 'http://127.0.0.1:8787/mcp/preview?k=s&turn=t1' },
      makeHandlers()
    )
    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    expect(args.some((a) => a.startsWith('mcp_servers.browser.url=') && a.includes('turn=t1'))).toBe(true)
    await tick()
    expect(input).toContain('mcp__browser__')
    expect(input).toContain('веб-превью')
  })

  it('remote + plan → без MCP и bypass, только read-only sandbox', async () => {
    const { child, stdin } = fakeChild()
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send(
      {
        prompt: 'составь план',
        sessionId: null,
        model: '',
        permissionMode: 'plan',
        remote: { mcpUrl: 'http://127.0.0.1/mcp', agentName: 'Ноутбук' }
      },
      makeHandlers()
    )
    const args = argsOf(spawn)
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(args.some((arg) => arg.startsWith('mcp_servers.remote.url='))).toBe(false)
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
    await tick()
    expect(input).toContain('Режим «План»')
    expect(input).toContain('Не изменяй файлы')
  })

  it('парсит JSONL: session, message → done с накопленным текстом', async () => {
    const { child, stdout } = fakeChild()
    const spawn: SpawnFn = vi.fn(() => child as never)
    const h = makeHandlers()
    new CodexCli({ spawn }).send({ prompt: 'x', sessionId: null, model: '' }, h)
    stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 't1' }) + '\n')
    stdout.write(
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Привет' } }) + '\n'
    )
    stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 9, output_tokens: 2 } }) + '\n')
    stdout.end()
    await tick()
    child.emit('close', 0)
    await tick()
    expect(h.calls.session).toContain('t1')
    expect(h.calls.done).toEqual(['Привет'])
    expect(h.calls.error).toHaveLength(0)
  })


  it('turn.completed передаёт usage в live-канал до завершения', async () => {
    const { child, stdout } = fakeChild()
    const spawn: SpawnFn = vi.fn(() => child as never)
    const h = makeHandlers()
    const order: string[] = []
    h.onUsage = (usage) => {
      order.push('usage')
      expect(usage).toEqual({ inputTokens: 9, outputTokens: 2, cacheReadTokens: 7 })
    }
    h.onDone = () => order.push('done')
    new CodexCli({ spawn }).send({ prompt: 'x', sessionId: null, model: '' }, h)
    stdout.write(JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 9, output_tokens: 2, cached_input_tokens: 7 }
    }) + '\n')
    await tick()
    expect(order).toEqual(['usage', 'done'])
  })

  it('error-событие → onError', async () => {
    const { child, stdout } = fakeChild()
    const spawn: SpawnFn = vi.fn(() => child as never)
    const h = makeHandlers()
    new CodexCli({ spawn }).send({ prompt: 'x', sessionId: null, model: '' }, h)
    stdout.write(JSON.stringify({ type: 'error', message: 'quota' }) + '\n')
    await tick()
    expect(h.calls.error).toContain('quota')
  })
})
