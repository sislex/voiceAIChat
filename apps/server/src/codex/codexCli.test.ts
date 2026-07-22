import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { CodexCli, type SpawnFn } from './codexCli'
import type { LlmStreamHandlers } from '../claude/types'

function fakeChild(): {
  child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void }
  stdout: PassThrough
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdout, stderr, kill: vi.fn() })
  return { child, stdout }
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
  it('базовые args: exec --json --skip-git-repo-check + модель + промпт последним', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child as never) as unknown as SpawnFn
    new CodexCli({ spawn }).send({ prompt: 'привет', sessionId: null, model: 'gpt-5-codex' }, makeHandlers())
    const args = argsOf(spawn)
    expect(args.slice(0, 3)).toEqual(['exec', '--json', '--skip-git-repo-check'])
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-5-codex')
    expect(args[args.length - 1]).toBe('привет')
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

  it('remote → -c mcp_servers.remote.url + read-only + инструкция в промпте', () => {
    const { child } = fakeChild()
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
    const prompt = args[args.length - 1]
    expect(prompt).toContain('remote')
    expect(prompt).toContain('Мак')
    expect(prompt).toContain('сделай что-то')
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
