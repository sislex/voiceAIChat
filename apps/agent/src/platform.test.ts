import { describe, it, expect } from 'vitest'
import { isTermux, isWindows, which, resolveShell, defaultRootDir } from './platform'

describe('isTermux', () => {
  it('true по TERMUX_VERSION', () => {
    expect(isTermux({ TERMUX_VERSION: '0.118' } as NodeJS.ProcessEnv)).toBe(true)
  })
  it('true по PREFIX с com.termux', () => {
    expect(isTermux({ PREFIX: '/data/data/com.termux/files/usr' } as NodeJS.ProcessEnv)).toBe(true)
  })
  it('false в обычном окружении', () => {
    expect(isTermux({ PATH: '/usr/bin' } as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe('which', () => {
  it('находит существующий бинарь в PATH', () => {
    // sh есть в любом POSIX-окружении CI.
    expect(which('sh')).toBeTruthy()
  })
  it('null для несуществующего', () => {
    expect(which('definitely-no-such-binary-xyz')).toBeNull()
  })
})

describe('isWindows', () => {
  it('true только для win32', () => {
    expect(isWindows('win32')).toBe(true)
    expect(isWindows('linux')).toBe(false)
    expect(isWindows('darwin')).toBe(false)
  })
})

describe('resolveShell', () => {
  it('на Windows берёт ComSpec, без него — cmd.exe', () => {
    expect(resolveShell({ ComSpec: 'C:\\Windows\\system32\\cmd.exe' } as NodeJS.ProcessEnv, 'win32')).toBe(
      'C:\\Windows\\system32\\cmd.exe'
    )
    expect(resolveShell({} as NodeJS.ProcessEnv, 'win32')).toBe('cmd.exe')
  })
  it('override через VC_PTY_SHELL, если путь существует', () => {
    expect(resolveShell({ VC_PTY_SHELL: '/bin/sh' } as NodeJS.ProcessEnv)).toBe('/bin/sh')
  })
  it('игнорирует несуществующий override и находит реальный shell', () => {
    const sh = resolveShell({ VC_PTY_SHELL: '/no/such/shell', PATH: process.env.PATH } as NodeJS.ProcessEnv)
    expect(sh.length).toBeGreaterThan(0)
    expect(sh).not.toBe('/no/such/shell')
  })
})

describe('defaultRootDir', () => {
  it('уважает VC_AGENT_ROOT', () => {
    expect(defaultRootDir({ VC_AGENT_ROOT: '/tmp/root' } as NodeJS.ProcessEnv)).toBe('/tmp/root')
  })
  it('в Termux берёт $HOME', () => {
    expect(defaultRootDir({ TERMUX_VERSION: '1', HOME: '/data/data/com.termux/files/home' } as NodeJS.ProcessEnv))
      .toBe('/data/data/com.termux/files/home')
  })
  it('в обычном окружении — cwd', () => {
    expect(defaultRootDir({ PATH: '/usr/bin' } as NodeJS.ProcessEnv)).toBe(process.cwd())
  })
})
