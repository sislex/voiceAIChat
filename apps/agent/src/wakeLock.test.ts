import { EventEmitter } from 'node:events'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { acquireWakeLock } from './wakeLock.js'

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, { exitCode: null, signalCode: null, killed: false, kill: vi.fn(() => true) })
  return child
}

describe('acquireWakeLock', () => {
  it('на macOS запускает один caffeinate только для idle system sleep и PID агента', () => {
    const child = fakeChild()
    const run = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => child)
    const env = { PATH: '/usr/bin' }
    const handle = acquireWakeLock({
      platform: 'darwin',
      env,
      pid: 4242,
      findBinary: () => '/usr/bin/caffeinate',
      spawn: run,
      log: () => {}
    })
    expect(run).toHaveBeenCalledWith('/usr/bin/caffeinate', ['-i', '-w', '4242'], { stdio: 'ignore', env })
    expect(run.mock.calls[0][1]).not.toContain('-d')
    handle.release()
    handle.release()
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('на Termux вызывает lock и ровно один unlock', () => {
    const children = [fakeChild(), fakeChild()]
    const run = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => children.shift() as ChildProcess)
    const handle = acquireWakeLock({
      platform: 'linux',
      env: { TERMUX_VERSION: '0.118' },
      findBinary: (name) => `/termux/bin/${name}`,
      spawn: run,
      log: () => {}
    })
    expect(run.mock.calls[0][0]).toContain('termux-wake-lock')
    handle.release()
    handle.release()
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1][0]).toContain('termux-wake-unlock')
  })

  it.each<NodeJS.Platform>(['linux', 'win32'])('на %s вне Termux ничего не запускает', (platform) => {
    const run = vi.fn()
    const handle = acquireWakeLock({ platform, env: { PATH: '/usr/bin' }, findBinary: () => '/unexpected', spawn: run })
    handle.release()
    expect(run).not.toHaveBeenCalled()
  })

  it('предупреждает об отсутствующем caffeinate и продолжает', () => {
    const warn = vi.fn()
    expect(() => acquireWakeLock({ platform: 'darwin', findBinary: () => null, warn })).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('caffeinate не найдена'))
  })

  it('предупреждает об ошибке spawn, не выбрасывая её', () => {
    const warn = vi.fn()
    expect(() =>
      acquireWakeLock({
        platform: 'darwin',
        findBinary: () => '/usr/bin/caffeinate',
        spawn: () => {
          throw new Error('ENOENT')
        },
        warn
      })
    ).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ENOENT'))
  })

  it('логирует ранний ненулевой exit платформенной команды', () => {
    const child = fakeChild()
    const warn = vi.fn()
    acquireWakeLock({
      platform: 'darwin',
      findBinary: () => '/usr/bin/caffeinate',
      spawn: () => child,
      warn,
      log: () => {}
    })
    child.emit('exit', 1, null)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exit code 1'))
  })

  it('ошибка unlock остаётся предупреждением, а release идемпотентен', () => {
    const warn = vi.fn()
    const run = vi.fn().mockReturnValueOnce(fakeChild()).mockImplementationOnce(() => {
      throw new Error('unlock failed')
    })
    const handle = acquireWakeLock({
      platform: 'linux',
      env: { TERMUX_VERSION: '1' },
      findBinary: (name) => name,
      spawn: run,
      warn,
      log: () => {}
    })
    handle.release()
    handle.release()
    expect(run).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unlock failed'))
  })
})

