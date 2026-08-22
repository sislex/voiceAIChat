import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commandEnv, isTermux, isWindows, which, resolveShell, resolveShellInfo, defaultRootDir } from './platform'

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

describe('commandEnv', () => {
  it('добавляет android_ndk_path для Termux', () => {
    const source = {
      TERMUX_VERSION: '0.118',
      PREFIX: '/data/data/com.termux/files/usr',
      PATH: '/custom/bin'
    } as NodeJS.ProcessEnv
    expect(commandEnv(source)).toEqual({
      ...source,
      GYP_DEFINES: 'android_ndk_path=/data/data/com.termux/files/usr'
    })
    expect(source.GYP_DEFINES).toBeUndefined()
  })

  it('не меняет окружение Linux, macOS и Windows', () => {
    const source = { PATH: '/usr/bin', GYP_DEFINES: 'custom=1' } as NodeJS.ProcessEnv
    expect(commandEnv(source)).toEqual(source)
    expect(commandEnv(source)).not.toBe(source)
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

describe('resolveShell/resolveShellInfo', () => {
  const dirs: string[] = []
  /** Временный каталог, который подчистится после теста. */
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'vc-platform-'))
    dirs.push(d)
    return d
  }

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
  })

  it('POSIX: override через VC_PTY_SHELL, если путь существует', () => {
    expect(resolveShell({ VC_PTY_SHELL: '/bin/sh' } as NodeJS.ProcessEnv)).toBe('/bin/sh')
  })

  it('POSIX: игнорирует несуществующий override и находит реальный shell', () => {
    const sh = resolveShell({ VC_PTY_SHELL: '/no/such/shell', PATH: process.env.PATH } as NodeJS.ProcessEnv)
    expect(sh.length).toBeGreaterThan(0)
    expect(sh).not.toBe('/no/such/shell')
  })

  it('Windows: находит bash.exe по PATH раньше cmd.exe', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'bash.exe'), '')
    const info = resolveShellInfo({ PATH: dir, ComSpec: 'C:\\Windows\\system32\\cmd.exe' } as NodeJS.ProcessEnv, 'win32')
    expect(info).toEqual({ shell: join(dir, 'bash.exe'), degraded: false })
  })

  it('Windows: без bash в PATH ищет его по известным путям Git for Windows', () => {
    const dir = tmp()
    const bashPath = join(dir, 'Git', 'bin', 'bash.exe')
    mkdirSync(join(dir, 'Git', 'bin'), { recursive: true })
    writeFileSync(bashPath, '')
    const info = resolveShellInfo({ ProgramFiles: dir } as NodeJS.ProcessEnv, 'win32')
    expect(info).toEqual({ shell: bashPath, degraded: false })
  })

  it('Windows: bash нигде не найден → cmd.exe (ComSpec) с признаком деградации', () => {
    expect(resolveShell({ ComSpec: 'C:\\Windows\\system32\\cmd.exe' } as NodeJS.ProcessEnv, 'win32')).toBe(
      'C:\\Windows\\system32\\cmd.exe'
    )
    expect(resolveShell({} as NodeJS.ProcessEnv, 'win32')).toBe('cmd.exe')
    expect(resolveShellInfo({} as NodeJS.ProcessEnv, 'win32')).toEqual({ shell: 'cmd.exe', degraded: true })
  })

  it('Windows: Unix-подобный SHELL/VC_PTY_SHELL игнорируется, а не используется как есть', () => {
    const info = resolveShellInfo({ SHELL: '/bin/bash' } as NodeJS.ProcessEnv, 'win32')
    expect(info.shell).toBe('cmd.exe')
    expect(info.degraded).toBe(true)
    expect(info.ignoredOverride).toBe('/bin/bash')
  })

  it('Windows: Unix-подобный override игнорируется, даже если bash находится другим путём', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'bash.exe'), '')
    const info = resolveShellInfo({ PATH: dir, VC_PTY_SHELL: '/bin/bash' } as NodeJS.ProcessEnv, 'win32')
    expect(info.shell).toBe(join(dir, 'bash.exe'))
    expect(info.degraded).toBe(false)
    expect(info.ignoredOverride).toBe('/bin/bash')
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
