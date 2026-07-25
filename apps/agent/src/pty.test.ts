import { describe, it, expect, afterEach } from 'vitest'
import { pickShell, startPty, writePty, killPty, ptyCount } from './pty'

afterEach(() => delete process.env.VC_PTY_SHELL)

describe('pickShell', () => {
  it('override через VC_PTY_SHELL', () => {
    process.env.VC_PTY_SHELL = '/bin/bash'
    expect(pickShell()).toBe('/bin/bash')
  })
  it('без override возвращает существующий бинарь shell', () => {
    delete process.env.VC_PTY_SHELL
    expect(pickShell().length).toBeGreaterThan(0)
  })
})

describe('startPty/killPty', () => {
  it('открывает сессию, стримит вывод и закрывается по kill', async () => {
    process.env.VC_PTY_SHELL = '/bin/bash'
    const events: Array<{ t: string }> = []
    startPty('p1', 80, 24, process.cwd(), (m) => events.push(m))
    expect(ptyCount()).toBe(1)
    // Команда с эхо, чтобы получить pty.output.
    writePty('p1', 'echo hello_pty\r')
    await new Promise((r) => setTimeout(r, 150))
    expect(events.some((e) => e.t === 'pty.output')).toBe(true)
    killPty('p1')
    await new Promise((r) => setTimeout(r, 250))
    expect(ptyCount()).toBe(0)
    expect(events.some((e) => e.t === 'pty.exit')).toBe(true)
  })

  it('повторный ptyId игнорируется', () => {
    process.env.VC_PTY_SHELL = '/bin/bash'
    const noop = (): void => {}
    startPty('dup', 80, 24, process.cwd(), noop)
    startPty('dup', 80, 24, process.cwd(), noop)
    expect(ptyCount()).toBe(1)
    killPty('dup')
  })
})
