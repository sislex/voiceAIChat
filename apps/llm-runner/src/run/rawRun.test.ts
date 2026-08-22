import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { PassThrough } from 'node:stream'
import type { LlmRunBody, LlmRunFrame } from '@voicechat/shared'
import { parseLlmRunFrame } from '@voicechat/shared'
import { CodexThreadInUseError, RunManager, type RunSink } from './rawRun.js'
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

/**
 * Путь вложения внутри каталога рана. Каталог берётся от `tmpdir()`, а не от
 * жёсткого `/tmp`: на macOS временный каталог — `/var/folders/...`, и зашитый
 * префикс делал тест зелёным только на Linux.
 */
function attachmentRe(name: string): RegExp {
  const dir = tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${dir}[/\\\\]+voicechat-llm-run-[^\\s]+[/\\\\]1-${name.replace('.', '\\.')}`)
}

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
    expect(sink.frames).toEqual([{ t: 'out', s: '{"type":"system"}' }])

    stderr.write('warning: что-то\n')
    stdout.end()
    stderr.end()
    await tick()
    child.emit('close', 0)
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

  it('вложения раскладываются во временный каталог, а пути в prompt подменяются', async () => {
    const { child, stdout, stderr } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const serverPath = '/data/uploads/u1/report.txt'
    new RunManager({ spawn }).start(
      request({
        prompt: `Прочитай ${serverPath}`,
        attachments: [
          {
            serverPath,
            runnerName: 'report.txt',
            dataBase64: Buffer.from('hello runner').toString('base64')
          }
        ]
      }),
      fakeSink()
    )

    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    const prompt = args[args.indexOf('-p') + 1]
    expect(prompt).not.toContain(serverPath)
    const match = prompt.match(attachmentRe('report.txt'))
    expect(match?.[0]).toBeTruthy()
    expect(readFileSync(match![0], 'utf8')).toBe('hello runner')

    stdout.end()
    stderr.end()
    child.emit('close', 0)
    await tick()
    expect(existsSync(dirname(match![0]))).toBe(false)
  })

  it('сохраняет путь удалённой машины и даёт CLI отдельную визуальную копию', async () => {
    const { child, stdout, stderr } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const machinePath = 'C:\\repos\\task\\.voicechat_uploads\\photo.png'
    new RunManager({ spawn }).start(
      request({
        prompt: `Открой ${machinePath} через remote:image`,
        attachments: [{
          serverPath: machinePath,
          runnerName: 'photo.png',
          dataBase64: Buffer.from('png').toString('base64'),
          preserveServerPath: true
        }]
      }),
      fakeSink()
    )

    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    const prompt = args[args.indexOf('-p') + 1]
    expect(prompt).toContain(`Открой ${machinePath} через remote:image`)
    const match = prompt.match(attachmentRe('photo.png'))
    expect(match?.[0]).toBeTruthy()
    expect(readFileSync(match![0], 'utf8')).toBe('png')

    stdout.end()
    stderr.end()
    child.emit('close', 0)
    await tick()
    expect(existsSync(dirname(match![0]))).toBe(false)
  })

  it('несуществующий cwd не уходит в spawn и не роняет запуск', () => {
    const { child } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    new RunManager({ spawn }).start(request({ cwd: '/definitely/missing/workdir' }), fakeSink())

    expect((spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBeUndefined()
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

  it('временный каталог рана удаляется после отмены', async () => {
    const { child, stdout, stderr } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const serverPath = '/data/uploads/u1/image.png'
    const runs = new RunManager({ spawn })
    runs.start(
      request({
        runId: 'r-cleanup',
        prompt: `Посмотри ${serverPath}`,
        attachments: [
          {
            serverPath,
            runnerName: 'image.png',
            dataBase64: Buffer.from('png').toString('base64')
          }
        ]
      }),
      fakeSink()
    )

    const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    const prompt = args[args.indexOf('-p') + 1]
    const match = prompt.match(attachmentRe('image.png'))
    expect(match?.[0]).toBeTruthy()
    expect(existsSync(dirname(match![0]))).toBe(true)

    expect(runs.cancel('r-cleanup')).toBe(true)
    stdout.end()
    stderr.end()
    child.emit('close', null)
    await tick()
    expect(existsSync(dirname(match![0]))).toBe(false)
  })

  it('cancel гасит процесс SIGTERM → SIGKILL, повторный вызов безопасен', async () => {
    vi.useFakeTimers()
    const { child, stdout, stderr, signals } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const runs = new RunManager({ spawn })
    const id = runs.start(request({ runId: 'r2' }), fakeSink())

    expect(runs.cancel(id)).toBe(true)
    expect(signals).toEqual(['SIGTERM'])
    vi.advanceTimersByTime(5_000)
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])

    expect(runs.cancel(id)).toBe(true)
    stdout.end()
    stderr.end()
    child.emit('close', null)
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

  it('обрыв соединения гасит CLI сразу, не дожидаясь таймаута', () => {
    const { child, signals } = fakeChild()
    const spawn = vi.fn(() => child) as unknown as SpawnFn
    const sink = fakeSink()
    const runs = new RunManager({ spawn, orphanMs: 60_000 })
    runs.start(request(), sink)

    sink.close()
    expect(signals).toEqual(['SIGTERM'])
    expect(runs.size).toBe(0)
  })

  it('spawn упал (нет бинаря) → кадр err и exit без кода', () => {
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

describe('RunManager: аренда Codex thread', () => {
  const resume = (runId: string, over: Partial<LlmRunBody> = {}): LlmRunBody =>
    request({ kind: 'codex', userId: 'u1', sessionId: 's1', model: '', runId, ...over })

  it('не запускает второй resume того же пользователя и thread, но изолирует ключи', () => {
    const children = [fakeChild(), fakeChild(), fakeChild(), fakeChild(), fakeChild()]
    const spawn = vi.fn(() => children.shift()!.child) as unknown as SpawnFn
    const runs = new RunManager({ spawn })

    runs.start(resume('r1'), fakeSink())
    expect(() => runs.start(resume('r2'), fakeSink())).toThrowError(CodexThreadInUseError)
    runs.start(resume('r3', { userId: 'u2' }), fakeSink())
    runs.start(resume('r4', { sessionId: 's2' }), fakeSink())
    runs.start(resume('r5', { sessionId: null }), fakeSink())
    runs.start(resume('r6', { sessionId: null }), fakeSink())

    expect(spawn).toHaveBeenCalledTimes(5)
  })

  it.each([0, 66])('освобождает аренду после close(%s)', async (code) => {
    const first = fakeChild()
    const second = fakeChild()
    const spawn = vi.fn().mockReturnValueOnce(first.child).mockReturnValueOnce(second.child) as unknown as SpawnFn
    const runs = new RunManager({ spawn })
    runs.start(resume('r1'), fakeSink())

    first.stdout.end()
    first.stderr.end()
    await tick()
    first.child.emit('close', code)
    await tick()

    runs.start(resume('r2'), fakeSink())
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('освобождает аренду после синхронной и асинхронной ошибки spawn', () => {
    const errored = fakeChild()
    const recovered = fakeChild()
    const spawn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('spawn ENOENT')
      })
      .mockReturnValueOnce(errored.child)
      .mockReturnValueOnce(recovered.child) as unknown as SpawnFn
    const runs = new RunManager({ spawn })

    runs.start(resume('r1'), fakeSink())
    runs.start(resume('r2'), fakeSink())
    errored.child.emit('error', new Error('child failed'))
    runs.start(resume('r3'), fakeSink())

    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('удерживает аренду после cancel до смерти процесса', async () => {
    const first = fakeChild()
    const second = fakeChild()
    const spawn = vi.fn().mockReturnValueOnce(first.child).mockReturnValueOnce(second.child) as unknown as SpawnFn
    const runs = new RunManager({ spawn })
    runs.start(resume('r1'), fakeSink())

    expect(runs.cancel('r1')).toBe(true)
    expect(() => runs.start(resume('r2'), fakeSink())).toThrowError(CodexThreadInUseError)
    first.stdout.end()
    first.stderr.end()
    await tick()
    first.child.emit('close', null)
    await tick()
    runs.start(resume('r3'), fakeSink())

    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('освобождает аренду при disconnect и orphan-timeout', async () => {
    vi.useFakeTimers()
    const first = fakeChild()
    const orphan = fakeChild()
    const recovered = fakeChild()
    const children = [first, orphan, recovered]
    const spawn = vi.fn(() => children.shift()!.child) as unknown as SpawnFn
    const runs = new RunManager({ spawn, orphanMs: 10 })
    const disconnected = fakeSink()
    runs.start(resume('r1'), disconnected)
    disconnected.close()
    runs.start(resume('r2'), fakeSink({ flushed: false }))

    orphan.stdout.write('backpressure\n')
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(10)
    runs.start(resume('r3'), fakeSink())

    expect(spawn).toHaveBeenCalledTimes(3)
  })
})
