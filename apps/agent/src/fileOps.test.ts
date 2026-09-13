import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { DEFAULT_AGENT_POLICY, type AgentPolicy } from '@voicechat/shared'
import { FS_PREVIEW_BYTES } from '@voicechat/shared'
import { fsList, fsRead, fsReadPrefix, fsWrite, fsDelete, fsDeleteFileSafe, fsRename, fsMkdir, fsTrash, TRASH_DIR, toNativePath } from './fileOps'

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  return { ...actual, readSync: vi.fn(actual.readSync), readFileSync: vi.fn(actual.readFileSync), closeSync: vi.fn(actual.closeSync) }
})

const OPEN: AgentPolicy = { ...DEFAULT_AGENT_POLICY }

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vc-fs-'))
  writeFileSync(join(root, 'a.txt'), 'привет')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('fileOps', () => {
  // @testCase T4
  it.each([0, 204799, 204800, 204801, 33554433])('physically reads at most 204800 bytes from size %s', (size) => {
    const path = join(root, 'large.txt')
    writeFileSync(path, '')
    fs.truncateSync(path, size)
    vi.mocked(fs.readSync).mockClear()
    vi.mocked(fs.readFileSync).mockClear()
    vi.mocked(fs.closeSync).mockClear()
    const result = fsReadPrefix(root, OPEN, path)
    const calls = vi.mocked(fs.readSync).mock.calls as unknown as Array<[number, Buffer, number, number, number]>
    expect(calls.reduce((sum, call) => sum + call[3], 0)).toBeLessThanOrEqual(FS_PREVIEW_BYTES)
    expect(calls.every((call) => call[4] >= 0 && call[4] + call[3] <= FS_PREVIEW_BYTES)).toBe(true)
    expect(fs.readFileSync).not.toHaveBeenCalled()
    expect(fs.closeSync).toHaveBeenCalledTimes(1)
    expect(result.bytesRead).toBe(Math.min(size, FS_PREVIEW_BYTES))
    expect(Buffer.from(result.dataBase64!, 'base64').length).toBe(result.bytesRead)
    expect(result.truncated).toBe(size > FS_PREVIEW_BYTES)
  })

  // @testCase T4
  it('handles short reads, EOF after shrink, and closes on read failure', () => {
    const path = join(root, 'a.txt')
    const actual = fs.readSync
    vi.mocked(fs.readSync).mockImplementationOnce(((fd: number, buffer: Buffer, offset: number, _length: number, position: number) => {
      buffer[offset] = 65
      return 1
    }) as typeof actual).mockImplementationOnce(() => 0)
    expect(fsReadPrefix(root, OPEN, path).bytesRead).toBe(1)
    vi.mocked(fs.closeSync).mockClear()
    vi.mocked(fs.readSync).mockImplementationOnce(() => { throw new Error('read failed') })
    expect(() => fsReadPrefix(root, OPEN, path)).toThrow('read failed')
    expect(fs.closeSync).toHaveBeenCalledTimes(1)
  })

  // @testCase T6
  it('preserves full reads and access restrictions for both read modes', () => {
    const path = join(root, 'a.txt')
    const ro = { ...OPEN, allowWrite: false }
    expect(fsReadPrefix(root, ro, path).dataBase64).toBe(fsRead(root, ro, path).dataBase64)
    expect(() => fsDelete(root, ro, path)).toThrow()
    const limited = { ...OPEN, allowedDirs: [join(root, 'allowed')] }
    for (const read of [fsRead, fsReadPrefix]) {
      expect(() => read(root, limited, path)).toThrow(/вне разрешённых/)
      expect(() => read(root, OPEN, join(root, 'missing'))).toThrow(/ENOENT/)
      expect(() => read(root, OPEN, root)).toThrow()
    }
    fs.truncateSync(path, 33554433)
    expect(() => fsRead(root, OPEN, path)).toThrow(/слишком большой/)
    expect(fsReadPrefix(root, OPEN, path).bytesRead).toBe(FS_PREVIEW_BYTES)
  })

  it('list возвращает содержимое корня (каталоги сверху)', () => {
    fsMkdir(root, OPEN, join(root, 'sub'))
    const res = fsList(root, OPEN, '')
    expect(res.root).toBe(root)
    expect(res.cwd).toBe(root)
    const names = res.entries!.map((e) => e.name)
    expect(names).toContain('a.txt')
    expect(names[0]).toBe('sub') // каталог первым
  })

  it('read отдаёт содержимое файла в base64', () => {
    const res = fsRead(root, OPEN, join(root, 'a.txt'))
    expect(res.name).toBe('a.txt')
    expect(Buffer.from(res.dataBase64!, 'base64').toString('utf8')).toBe('привет')
  })

  it('write создаёт файл и возвращает листинг', () => {
    const res = fsWrite(root, OPEN, join(root, 'b.txt'), Buffer.from('data').toString('base64'))
    expect(res.entries!.some((e) => e.name === 'b.txt')).toBe(true)
  })

  it('rename и delete', () => {
    fsRename(root, OPEN, join(root, 'a.txt'), join(root, 'c.txt'))
    expect(fsList(root, OPEN, '').entries!.some((e) => e.name === 'c.txt')).toBe(true)
    fsDelete(root, OPEN, join(root, 'c.txt'))
    expect(fsList(root, OPEN, '').entries!.some((e) => e.name === 'c.txt')).toBe(false)
  })

  it('safe delete не следует по симлинку и не удаляет каталог', () => {
    const outside = join(root, '..', `outside-${Date.now()}.txt`)
    writeFileSync(outside, 'keep')
    symlinkSync(outside, join(root, 'link'))
    expect(fsList(root, OPEN, '').entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'link', kind: 'symlink' })]))
    expect(() => fsDeleteFileSafe(root, OPEN, join(root, 'link'))).toThrow(/обычного файла/)
    expect(existsSync(outside)).toBe(true)
    fsMkdir(root, OPEN, join(root, 'dir'))
    expect(() => fsDeleteFileSafe(root, OPEN, join(root, 'dir'))).toThrow(/обычного файла/)
    fsDeleteFileSafe(root, OPEN, join(root, 'a.txt'))
    expect(existsSync(join(root, 'a.txt'))).toBe(false)
    rmSync(outside, { force: true })
  })

  it('корзина: элемент переезжает в .voicechat_trash с меткой времени, откат — rename по trashedPath', () => {
    const result = fsTrash(root, OPEN, join(root, 'a.txt'), new Date('2026-08-28T10:11:12.345Z'))
    expect(result.trashedPath).toBe(join(root, TRASH_DIR, '20260828-101112__a.txt'))
    expect(existsSync(join(root, 'a.txt'))).toBe(false)
    expect(existsSync(result.trashedPath!)).toBe(true)
    // листинг возвращается для каталога, откуда удалили; сама корзина в нём видна как каталог
    expect(result.entries!.some((e) => e.name === TRASH_DIR && e.kind === 'dir')).toBe(true)
    fsRename(root, OPEN, result.trashedPath!, join(root, 'a.txt'))
    expect(existsSync(join(root, 'a.txt'))).toBe(true)
    // повторно в корзину из корзины и сам корень — нельзя
    const again = fsTrash(root, OPEN, join(root, 'a.txt'), new Date('2026-08-28T10:11:13Z'))
    expect(() => fsTrash(root, OPEN, again.trashedPath!)).toThrow(/уже в корзине/)
    expect(() => fsTrash(root, OPEN, root)).toThrow(/корень/)
  })

  it('mkdir возвращает листинг РОДИТЕЛЯ с новой папкой (видна в текущем каталоге)', () => {
    const res = fsMkdir(root, OPEN, join(root, 'newdir'))
    expect(res.cwd).toBe(root) // остаёмся в текущем каталоге
    expect(res.entries!.some((e) => e.name === 'newdir' && e.kind === 'dir')).toBe(true)
  })

  it('без allowWrite мутации запрещены, чтение разрешено', () => {
    const ro: AgentPolicy = { ...DEFAULT_AGENT_POLICY, allowWrite: false }
    expect(() => fsWrite(root, ro, join(root, 'x.txt'), '')).toThrow(/запрещено/i)
    expect(() => fsDelete(root, ro, join(root, 'a.txt'))).toThrow()
    // чтение — ок
    expect(fsList(root, ro, '').entries!.length).toBeGreaterThan(0)
  })

  it('allowedDirs ограничивает доступ вне разрешённых каталогов', () => {
    const limited: AgentPolicy = { ...DEFAULT_AGENT_POLICY, allowedDirs: [join(root, 'sub')] }
    expect(() => fsList(root, limited, root)).toThrow(/вне разрешённых/i)
  })

  it('allowedDirs проверяется по НОРМАЛИЗОВАННОМУ пути (`..` не обходит политику)', () => {
    fsMkdir(root, OPEN, join(root, 'sub'))
    const limited: AgentPolicy = { ...DEFAULT_AGENT_POLICY, allowedDirs: [join(root, 'sub')] }
    expect(() => fsList(root, limited, join(root, 'sub', '..'))).toThrow(/вне разрешённых/i)
    expect(fsList(root, limited, join(root, 'sub', '.')).cwd).toBe(join(root, 'sub'))
  })
})

describe('пути Git Bash (MSYS) на Windows', () => {
  const MSYS = '/c/Users/Lenovo/public/seo-second-page-retouched.png'

  it('регрессия: /c/Users/... больше не превращается в …\\c\\Users\\… (ENOENT на fs.read)', () => {
    // Старое поведение: resolve() считал MSYS-путь путём от корня текущего диска.
    expect(win32.resolve(MSYS)).toMatch(/^(?:[A-Za-z]:)?\\c\\Users\\Lenovo\\public\\/)
    expect(toNativePath(MSYS, 'win32')).toBe('C:\\Users\\Lenovo\\public\\seo-second-page-retouched.png')
  })

  it('буква диска в любом регистре', () => {
    expect(toNativePath('/C/Users/Lenovo', 'win32')).toBe('C:\\Users\\Lenovo')
    expect(toNativePath('/d/tmp/x.png', 'win32')).toBe('D:\\tmp\\x.png')
    expect(toNativePath('/c', 'win32')).toBe('C:\\')
  })

  it('нативные Windows-пути не ломаются', () => {
    expect(toNativePath('C:\\Users\\Lenovo\\public\\a.png', 'win32')).toBe('C:\\Users\\Lenovo\\public\\a.png')
    expect(toNativePath('C:/Users/Lenovo/public/a.png', 'win32')).toBe('C:\\Users\\Lenovo\\public\\a.png')
    expect(toNativePath('c:\\Users\\x', 'win32')).toBe('C:\\Users\\x') // регистр диска нормализуется
    expect(toNativePath('\\\\srv\\share\\a.png', 'win32')).toBe('\\\\srv\\share\\a.png') // UNC не трогаем
    // `\c\...` — путь от корня ТЕКУЩЕГО диска, а не MSYS: букву диска отсюда не берём.
    expect(toNativePath('\\c\\tmp', 'win32')).toMatch(/\\c\\tmp$/)
  })

  it('на POSIX /c/... остаётся обычным путём', () => {
    expect(toNativePath(MSYS, 'linux')).toBe(MSYS)
    expect(toNativePath('/c/x/../y', 'darwin')).toBe('/c/y')
  })

  it.runIf(process.platform === 'win32')('fsRead читает файл по MSYS-пути', () => {
    const msys = `/${root[0].toLowerCase()}${root.slice(2).replace(/\\/g, '/')}/a.txt`
    const res = fsRead(root, OPEN, msys)
    expect(Buffer.from(res.dataBase64!, 'base64').toString('utf8')).toBe('привет')
  })
})
