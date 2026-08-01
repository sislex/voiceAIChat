import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { LlmRunBody, LlmRunFrame } from '@voicechat/shared'
import { parseLlmRunFrame } from '@voicechat/shared'
import { RunManager, type RunSink } from './rawRun.js'
import type { SpawnFn } from '../cli/claudeCli.js'

/** Фейковый процесс CLI: реальные claude/codex в тестах не запускаются. */
function fakeChild(): {
  child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough }
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  signals: string[]
} {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const signals: string[] = []
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: (s: NodeJS.Signals) => {
      signals.push(s)
      return true
    }
  })
  return { child, stdin, stdout, stderr, signals }
}

/** Приёмник кадров: копит их и умеет притворяться «клиент не читает». */
function fakeSink(opts: { flushed?: boolean } = {}): RunSink & {
  frames: LlmRunFrame[]
  drain(): void
  close(): void
  ended: () => boolean
} {
  const frames: LlmRunFrame[] = []
  let drainCb: (() => void) | undefined
  let closeCb: (() => void) | undefined
  let ended = false
  return {
    frames,
    write: (chunk) => {
      for (const line of chunk.split('\n')) {
        const frame = parseLlmRunFrame(line)
        if (frame) frames.push(frame)
      }
      return opts.flushed ?? true
    },
    onDrain: (cb) => {
      drainCb = cb
    },
    onClose: (cb) => {
      closeCb = cb
    },
    end: () => {
      ended = true
    },
    drain: () => drainCb?.(),
    close: () => closeCb?.(),
    ended: () => ended
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

const request = (over: Partial<LlmRunBody> = {}): LlmRunBody => ({
  kind: 'claude',
  prompt: 'привет',
  sessionId: null,
  model: 'sonnet',
  ...over
})

afterEach(() => vi.useRealTimers())

describe('RunManager', () => {
  it('строки stdout уходят кадрами out, stderr — err, в конце exit', async () => {
    const { child, stdout, stderr } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const sink = fakeSink()
    const runs = new RunManager({ spawn })

    runs.start(request({ runId: 'r1' }), sink)
    stdout.write('{"type":"system"}\n')
    await tick()
    // Кадр появился до завершения процесса — значит вывод не буферизуется.
    expect(sink.frames).toEqual([{ t: 'out', s: '{"type":"system"}' }])

    stderr.write('warning: что-то\n')
    stdout.end()
    stderr.end()
    await tick()
    child.emit('close', 0)
    // Кадр exit ждём: хвост stdout закрывается не синхронно с процессом.
    await vi.waitFor(() => expect(sink.frames.at(-1)?.t).toBe('exit'), { timeout: 3_000 })

    expect(sink.frames).toEqual([
      { t: 'out', s: '{"type":"system"}' },
      { t: 'err', s: 'warning: что-то' },
      { t: 'exit', code: 0 }
    ])
    expect(sink.ended()).toBe(true)
    expect(runs.size).toBe(0)
  })

  it('исполнитель не разбирает stream-json: строка доходит как есть', async () => {
    const { child, stdout } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const sink = fakeSink()
    new RunManager({ spawn }).start(request(), sink)

    const line = JSON.stringify({ type: 'result', is_error: false, result: 'Привет' })
    stdout.write(line + '\n')
    await tick()

    expect(sink.frames[0]).toEqual({ t: 'out', s: line })
  })

  it('codex получает промпт через stdin', async () => {
    const { child, stdin } = fakeChild()
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    new RunManager({ spawn, codexBin: 'codex' }).start(request({ kind: 'codex', prompt: 'сделай' }), fakeSink())
    await tick()

    expect((spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('codex')
    expect((spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toContain('exec')
    expect(input).toContain('сделай')
  })

  it('cancel гасит процесс SIGTERM → SIGKILL, повторный вызов безопасен', async () => {
    vi.useFakeTimers()
    const { child, signals } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const runs = new RunManager({ spawn })
    const id = runs.start(request({ runId: 'r2' }), fakeSink())

    expect(runs.cancel(id)).toBe(true)
    expect(signals).toEqual(['SIGTERM'])
    vi.advanceTimersByTime(5_000)
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])

    // Второй раз — тот же ран ещё в реестре: сигнал повторно не навредит.
    expect(runs.cancel(id)).toBe(true)
    child.emit('close', null)
    // Ран завершился — отмена больше не находит его, но и не падает.
    expect(runs.cancel(id)).toBe(false)
    expect(runs.cancel('нет-такого')).toBe(false)
  })

  it('брошенный поток: клиент не читает N мс → CLI убит (сирота)', async () => {
    vi.useFakeTimers()
    const { child, stdout, signals } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const sink = fakeSink({ flushed: false })
    const runs = new RunManager({ spawn, orphanMs: 10_000 })
    runs.start(request({ runId: 'r3' }), sink)

    stdout.write('первая строка\n')
    await vi.advanceTimersByTimeAsync(1)
    expect(signals).toEqual([])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(signals).toEqual(['SIGTERM'])
    expect(sink.ended()).toBe(true)
    expect(runs.size).toBe(0)
  })

  it('клиент вычитал буфер до таймаута — ран продолжается', async () => {
    vi.useFakeTimers()
    const { child, stdout, signals } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const sink = fakeSink({ flushed: false })
    const runs = new RunManager({ spawn, orphanMs: 10_000 })
    runs.start(request(), sink)

    stdout.write('строка\n')
    await vi.advanceTimersByTimeAsync(1)
    sink.drain()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(signals).toEqual([])
    expect(runs.size).toBe(1)
  })

  it('обрыв соединения гасит CLI сразу, не дожидаясь таймаута', async () => {
    const { child, signals } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const sink = fakeSink()
    const runs = new RunManager({ spawn, orphanMs: 60_000 })
    runs.start(request(), sink)

    sink.close()
    expect(signals).toEqual(['SIGTERM'])
    expect(runs.size).toBe(0)
  })

  it('spawn упал (нет бинаря) → кадр err и exit без кода', async () => {
    const spawn = vi.fn(() => {
      throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    }) as unknown as SpawnFn
    const sink = fakeSink()
    const runs = new RunManager({ spawn })
    runs.start(request(), sink)

    expect(sink.frames).toEqual([
      { t: 'err', s: 'spawn claude ENOENT' },
      { t: 'exit', code: null }
    ])
    expect(runs.size).toBe(0)
  })

  it('ненулевой код выхода доезжает в кадре exit', async () => {
    const { child, stdout, stderr } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const sink = fakeSink()
    new RunManager({ spawn }).start(request(), sink)

    stdout.end()
    stderr.end()
    await tick()
    child.emit('close', 66)
    await vi.waitFor(() => expect(sink.frames.at(-1)).toEqual({ t: 'exit', code: 66 }), {
      timeout: 3_000
    })
  })
})
