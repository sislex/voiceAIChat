import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { PiperTtsEngine, type SpawnFn } from './piperTts'

/** Фейковый piper: пишет WAV в путь из args (-f) и завершается кодом. */
function fakePiperSpawn(exitCode = 0): { spawn: SpawnFn; args: () => string[]; stdin: () => string } {
  let capturedArgs: string[] = []
  let stdinData = ''
  const spawn: SpawnFn = (_cmd, args) => {
    capturedArgs = args
    const outPath = args[args.indexOf('-f') + 1]
    const stdin = new PassThrough()
    const child = Object.assign(new EventEmitter(), {
      stdin,
      stderr: new PassThrough(),
      kill: vi.fn()
    })
    stdin.on('data', (c) => {
      stdinData += c.toString()
    })
    stdin.on('finish', () => {
      setImmediate(() => {
        if (exitCode === 0) {
          const buf = Buffer.alloc(44 + 4)
          buf.write('RIFF', 0)
          buf.write('WAVE', 8)
          writeFileSync(outPath, buf)
        }
        child.emit('close', exitCode)
      })
    })
    return child as never
  }
  return { spawn, args: () => capturedArgs, stdin: () => stdinData }
}

describe('PiperTtsEngine', () => {
  it('синтезирует WAV, передаёт очищенный текст и путь голоса', async () => {
    const fake = fakePiperSpawn(0)
    const engine = new PiperTtsEngine({
      piperBin: '/bin/piper',
      voicesDir: '/voices',
      spawn: fake.spawn
    })
    const result = await engine.synthesize('## Привет', { voice: 'ru_RU-irina-medium' })

    expect(Buffer.from(result.audio).toString('ascii', 0, 4)).toBe('RIFF')
    expect(fake.stdin()).toBe('Привет') // markdown очищен
    const args = fake.args()
    expect(args[args.indexOf('-m') + 1]).toBe('/voices/ru_RU-irina-medium.onnx')
  })

  it('ошибка при ненулевом коде piper', async () => {
    const fake = fakePiperSpawn(1)
    const engine = new PiperTtsEngine({ piperBin: '/bin/piper', voicesDir: '/v', spawn: fake.spawn })
    await expect(engine.synthesize('т', { voice: 'irina' })).rejects.toThrow(/кодом 1/)
  })
})
