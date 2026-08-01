import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { ClaudeCli, type SpawnFn } from './claudeCli'
import type { LlmStreamHandlers } from '@voicechat/shared'

/** Фейковый дочерний процесс: EventEmitter + потоки stdout/stderr. */
function fakeChild(): {
  child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void }
  stdout: PassThrough
  stderr: PassThrough
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdout, stderr, kill: vi.fn() })
  return { child, stdout, stderr }
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

describe('ClaudeCli', () => {
  it('стримит дельты, ловит session_id и финальный текст', async () => {
    const { child, stdout } = fakeChild()
    const spawn: SpawnFn = vi.fn(() => child as never)
    const cli = new ClaudeCli({ spawn })
    const h = makeHandlers()

    cli.send({ prompt: 'привет', sessionId: null, model: 'sonnet' }, h)

    stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }) + '\n')
    stdout.write(
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'При' } }
      }) + '\n'
    )
    stdout.write(
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'вет' } }
      }) + '\n'
    )
    stdout.write(
      JSON.stringify({ type: 'result', is_error: false, result: 'Привет', session_id: 's1' }) + '\n'
    )
    stdout.end()
    await tick()
    child.emit('close', 0)
    await tick()

    expect(h.calls.session).toContain('s1')
    expect(h.calls.delta).toEqual(['При', 'вет'])
    expect(h.calls.done).toEqual(['Привет'])
    expect(h.calls.error).toHaveLength(0)
  })

  it('добавляет --resume при наличии sessionId и --model', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    const cli = new ClaudeCli({ spawn })
    cli.send(
      { prompt: 'x', sessionId: 'sess-7', model: 'opus' },
      makeHandlers()
    )
    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    expect(args).toContain('--resume')
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-7')
    expect(args[args.indexOf('--model') + 1]).toBe('opus')
    expect(args).toContain('stream-json')
  })

  it('добавляет --permission-mode, когда задан; без него флага нет', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    const cli = new ClaudeCli({ spawn })
    cli.send({ prompt: 'x', sessionId: null, model: 'opus', permissionMode: 'plan' }, makeHandlers())
    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan')

    const { child: child2 } = fakeChild()
    const spawn2 = vi.fn(() => child2 as never) as unknown as SpawnFn
    new ClaudeCli({ spawn: spawn2 }).send({ prompt: 'x', sessionId: null, model: 'opus' }, makeHandlers())
    const args2 = (spawn2 as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    expect(args2).not.toContain('--permission-mode')
  })

  it('remote: добавляет --mcp-config/--disallowedTools/--allowedTools; без remote — нет', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new ClaudeCli({ spawn }).send(
      {
        prompt: 'x',
        sessionId: null,
        model: 'opus',
        remote: { mcpUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=s&agent=a1', agentName: 'Мак' }
      },
      makeHandlers()
    )
    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1]) as {
      mcpServers: { remote: { type: string; url: string } }
    }
    expect(mcpConfig.mcpServers.remote.type).toBe('http')
    expect(mcpConfig.mcpServers.remote.url).toContain('agent=a1')
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('Bash')
    // toContain, а не toBe: в allow-list могут добавляться инструменты БЗ/CI.
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('mcp__remote__bash')
    expect(args[args.indexOf('--append-system-prompt') + 1]).toContain('Мак')
    // Долгие команды (тесты/сборка) не должны срезаться дефолтным таймаутом моста.
    expect(args[args.indexOf('--append-system-prompt') + 1]).toContain('timeout_ms')

    const { child: c2 } = fakeChild()
    const spawn2 = vi.fn(() => c2 as never) as unknown as SpawnFn
    new ClaudeCli({ spawn: spawn2 }).send(
      { prompt: 'x', sessionId: null, model: 'opus' },
      makeHandlers()
    )
    const args2 = (spawn2 as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    expect(args2).not.toContain('--mcp-config')
    expect(args2).not.toContain('--disallowedTools')
  })

  it('kbMcpUrl: сервер kb в --mcp-config и хинт «БЗ в первую очередь» без машины', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new ClaudeCli({ spawn }).send(
      { prompt: 'x', sessionId: null, model: 'opus', kbMcpUrl: 'http://127.0.0.1:8787/mcp/kb?k=s&turn=t1', kbMode: 'manual' },
      makeHandlers()
    )
    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]) as { mcpServers: Record<string, { url: string }> }
    expect(config.mcpServers.kb.url).toContain('turn=t1')
    expect(args[args.indexOf('--append-system-prompt') + 1]).toContain('mcp__kb__search')
    expect(args[args.indexOf('--append-system-prompt') + 1]).toContain('единственный путь')
    // Без remote allow-list не передаём: он выключил бы автоодобрение Read/Grep.
    expect(args).not.toContain('--allowedTools')
    expect(args).not.toContain('--disallowedTools')
  })

  it('kbMcpUrl + remote: инструменты БЗ попадают в allow-list одним хинтом', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new ClaudeCli({ spawn }).send(
      {
        prompt: 'x', sessionId: null, model: 'opus', kbMcpUrl: 'http://127.0.0.1:8787/mcp/kb?k=s&turn=t1',
        remote: { mcpUrl: 'http://127.0.0.1:8787/mcp/remote-bash?k=s&agent=a1', agentName: 'Мак' }
      },
      makeHandlers()
    )
    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]) as { mcpServers: Record<string, unknown> }
    expect(Object.keys(config.mcpServers).sort()).toEqual(['kb', 'remote'])
    const allowed = args[args.indexOf('--allowedTools') + 1]
    expect(allowed).toContain('mcp__remote__bash')
    expect(allowed).toContain('mcp__kb__document')
    // CLI принимает --append-system-prompt один раз: оба хинта склеены.
    expect(args.filter((a) => a === '--append-system-prompt')).toHaveLength(1)
    const hint = args[args.indexOf('--append-system-prompt') + 1]
    expect(hint).toContain('mcp__remote__bash')
    expect(hint).toContain('mcp__kb__search')
  })

  it('передаёт cwd в spawn, когда задан; иначе третий аргумент undefined', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new ClaudeCli({ spawn }).send({ prompt: 'x', sessionId: null, model: 'opus', cwd: '/tmp/p' }, makeHandlers())
    const opts = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(opts).toEqual({ cwd: '/tmp/p' })

    const { child: c2 } = fakeChild()
    const spawn2 = vi.fn(() => c2 as never) as unknown as SpawnFn
    new ClaudeCli({ spawn: spawn2 }).send({ prompt: 'x', sessionId: null, model: 'opus' }, makeHandlers())
    expect((spawn2 as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBeUndefined()
  })

  it('ENOENT (нет бинаря) → понятная ошибка с подсказкой claude login', async () => {
    const { child } = fakeChild()
    const spawn: SpawnFn = vi.fn(() => child as never)
    const cli = new ClaudeCli({ spawn })
    const h = makeHandlers()
    cli.send({ prompt: 'x', sessionId: null, model: 'sonnet' }, h)

    child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))
    await tick()

    expect(h.calls.error).toHaveLength(1)
    expect(String(h.calls.error[0])).toMatch(/не найден|claude login/i)
  })

  it('spawn бросает синхронно → onError без падения', () => {
    const spawn: SpawnFn = vi.fn(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const cli = new ClaudeCli({ spawn })
    const h = makeHandlers()
    expect(() =>
      cli.send({ prompt: 'x', sessionId: null, model: 'sonnet' }, h)
    ).not.toThrow()
    expect(h.calls.error).toHaveLength(1)
  })

  it('ненулевой код + stderr про логин → подсказка про вход', async () => {
    const { child, stdout, stderr } = fakeChild()
    const spawn: SpawnFn = vi.fn(() => child as never)
    const cli = new ClaudeCli({ spawn })
    const h = makeHandlers()
    cli.send({ prompt: 'x', sessionId: null, model: 'sonnet' }, h)

    stderr.write('Error: not logged in. Please run claude login\n')
    stdout.end()
    await tick()
    child.emit('close', 1)
    await tick()

    expect(h.calls.done).toHaveLength(0)
    expect(String(h.calls.error[0])).toMatch(/вход|login/i)
  })
})

describe('ClaudeCli: живой счётчик токенов (onUsage)', () => {
  it('шлёт кумулятивные итоги по сообщениям и не дублирует одинаковые', async () => {
    const { child, stdout } = fakeChild()
    const spawn: SpawnFn = vi.fn(() => child as never)
    const cli = new ClaudeCli({ spawn })
    const h = makeHandlers()
    const usage: unknown[] = []
    h.onUsage = (u) => usage.push(u)

    cli.send({ prompt: 'x', sessionId: null, model: 'sonnet' }, h)
    const tickWrite = (obj: unknown): boolean => stdout.write(JSON.stringify(obj) + '\n')
    tickWrite({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 50 } }
      }
    })
    tickWrite({
      type: 'assistant',
      message: { id: 'm1', content: [], usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 50 } }
    })
    // Дубль usage (assistant повторяется на каждый content-блок) — не рассылается.
    tickWrite({
      type: 'assistant',
      message: { id: 'm1', content: [], usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 50 } }
    })
    // Второе API-сообщение агентного цикла: вход суммируется, выход растёт.
    tickWrite({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'm2', usage: { input_tokens: 12, output_tokens: 1 } } }
    })
    tickWrite({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 30 } } })
    await tick()

    expect(usage).toEqual([
      { inputTokens: 10, outputTokens: 1, cacheReadTokens: 50 },
      { inputTokens: 10, outputTokens: 20, cacheReadTokens: 50 },
      { inputTokens: 22, outputTokens: 21, cacheReadTokens: 50 },
      { inputTokens: 22, outputTokens: 50, cacheReadTokens: 50 }
    ])
  })
})
