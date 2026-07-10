import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { SayTtsEngine, type SpawnFn } from './sayTts'

/** Фейковый `say`: пишет маленький WAV в путь из args (-o) и завершается кодом 0. */
function fakeSaySpawn(exitCode = 0): { spawn: SpawnFn; stdinData: () => string } {
  let captured = ''
  const spawn: SpawnFn = (_cmd, args) => {
    const outPath = args[args.indexOf('-o') + 1]
    const stdin = new PassThrough()
    const stderr = new PassThrough()
    const child = Object.assign(new EventEmitter(), { stdin, stderr, kill: vi.fn() })
    stdin.on('data', (c) => {
      captured += c.toString()
    })
    stdin.on('finish', () => {
      setImmediate(() => {
        if (exitCode === 0) {
          // минимальный валидный WAV-заголовок + немного данных
          const buf = Buffer.alloc(44 + 8)
          buf.write('RIFF', 0)
          buf.write('WAVE', 8)
          buf.write('data', 36)
          writeFileSync(outPath, buf)
        }
        child.emit('close', exitCode)
      })
    })
    return child as never
  }
  return { spawn, stdinData: () => captured }
}

describe('SayTtsEngine', () => {
  it('синтезирует WAV-байты и передаёт очищенный текст в stdin', async () => {
    const { spawn, stdinData } = fakeSaySpawn(0)
    const engine = new SayTtsEngine({ spawn })
    const result = await engine.synthesize('# Привет\n**мир**', { voice: 'irina' })

    expect(result.mime).toBe('audio/wav')
    expect(Buffer.from(result.audio).toString('ascii', 0, 4)).toBe('RIFF')
    // markdown очищен перед подачей в say
    expect(stdinData()).toBe('Привет\nмир')
  })

  it('пробрасывает ошибку при ненулевом коде say', async () => {
    const { spawn } = fakeSaySpawn(1)
    const engine = new SayTtsEngine({ spawn })
    await expect(engine.synthesize('текст', { voice: 'irina' })).rejects.toThrow(/кодом 1/)
  })

  it('cancel убивает текущий процесс', async () => {
    const kills: unknown[] = []
    const spawn: SpawnFn = (_cmd, _args) => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => kills.push(true)
      })
      return child as never // никогда не эмитит close → синтез «висит»
    }
    const engine = new SayTtsEngine({ spawn })
    void engine.synthesize('текст', { voice: 'irina' })
    await new Promise((r) => setImmediate(r))
    engine.cancel()
    expect(kills).toHaveLength(1)
  })
})
