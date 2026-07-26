import { describe, it, expect, afterEach } from 'vitest'
import { pickShell, startPty, writePty, killPty, ptyCount } from './pty'

afterEach(() => {
  delete process.env.VC_PTY_SHELL
  delete process.env.VC_PTY_FORCE_FALLBACK
})

describe('pickShell', () => {
  it('override через VC_PTY_SHELL', () => {
    process.env.VC_PTY_SHELL = '/bin/bash'
    expect(pickShell()).toBe('/bin/bash')
  })
  it('без override возвращает существующий бинарь shell', () => {
    delete process.env.VC_PTY_SHELL
    expect(pickShell().length).toBeGreaterThan(0)
  })
  it('на Windows без PowerShell в PATH берёт ComSpec, без него — cmd.exe', () => {
    const env = { PATH: '/nonexistent', ComSpec: 'C:\\Windows\\system32\\cmd.exe' } as NodeJS.ProcessEnv
    expect(pickShell(env, 'win32')).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(pickShell({ PATH: '/nonexistent' } as NodeJS.ProcessEnv, 'win32')).toBe('cmd.exe')
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

describe('fallback-терминал (VC_PTY_FORCE_FALLBACK)', () => {
  it('pipe-режим: стримит вывод и закрывается по kill', async () => {
    process.env.VC_PTY_SHELL = '/bin/bash'
    process.env.VC_PTY_FORCE_FALLBACK = '1'
    const events: Array<{ t: string; data?: string }> = []
    startPty('fb1', 80, 24, process.cwd(), (m) => events.push(m))
    expect(ptyCount()).toBe(1)
    writePty('fb1', 'echo hello_fallback\n')
    await new Promise((r) => setTimeout(r, 200))
    const out = events.filter((e) => e.t === 'pty.output').map((e) => e.data ?? '').join('')
    expect(out).toContain('hello_fallback')
    // Перевод строки нормализован в \r\n для xterm.
    expect(out.includes('\r\n')).toBe(true)
    killPty('fb1')
    await new Promise((r) => setTimeout(r, 250))
    expect(ptyCount()).toBe(0)
    expect(events.some((e) => e.t === 'pty.exit')).toBe(true)
  })
})
