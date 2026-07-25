import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readUserFile, resolveUserFile } from './serverFiles.js'

let base: string
let home: string
let outside: string

beforeEach(() => {
  // realpath сразу: на macOS /var — симлинк на /private/var, а функция
  // намеренно возвращает разыменованный путь.
  base = realpathSync(mkdtempSync(join(tmpdir(), 'vc-files-')))
  home = join(base, 'cli-users', 'YWRtaW4')
  outside = join(base, 'other-user')
  mkdirSync(join(home, '.codex', 'generated_images', 'sess'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(home, '.codex', 'generated_images', 'sess', 'pic.png'), 'PNGDATA')
  writeFileSync(join(outside, 'secret.png'), 'NOPE')
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('resolveUserFile — что считается «своим»', () => {
  it('файл внутри корня разрешён', () => {
    const p = join(home, '.codex', 'generated_images', 'sess', 'pic.png')
    expect(resolveUserFile(p, [home])).toBe(p)
  })

  it('файл вне корней запрещён', () => {
    expect(resolveUserFile(join(outside, 'secret.png'), [home])).toBeNull()
  })

  it('обход через .. не проходит', () => {
    const escape = join(home, '..', 'other-user', 'secret.png')
    expect(resolveUserFile(escape, [home])).toBeNull()
  })

  it('симлинк из своего корня наружу не открывает доступ', () => {
    const link = join(home, 'link.png')
    symlinkSync(join(outside, 'secret.png'), link)
    expect(resolveUserFile(link, [home])).toBeNull()
  })

  it('соседний каталог с общим префиксом имени — не внутри корня', () => {
    const sibling = `${home}-evil`
    mkdirSync(sibling, { recursive: true })
    writeFileSync(join(sibling, 'a.png'), 'x')
    expect(resolveUserFile(join(sibling, 'a.png'), [home])).toBeNull()
  })

  it('пустой путь и несуществующий файл — null', () => {
    expect(resolveUserFile('', [home])).toBeNull()
    expect(resolveUserFile(join(home, 'нет.png'), [home])).toBeNull()
  })

  it('несуществующий корень просто пропускается, остальные работают', () => {
    const p = join(home, '.codex', 'generated_images', 'sess', 'pic.png')
    expect(resolveUserFile(p, [join(base, 'нет-такого'), home])).toBe(p)
  })
})

describe('readUserFile — чтение с проверкой', () => {
  it('отдаёт имя и base64 своего файла', () => {
    const res = readUserFile(join(home, '.codex', 'generated_images', 'sess', 'pic.png'), [home])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.file.name).toBe('pic.png')
    expect(Buffer.from(res.file.dataBase64, 'base64').toString()).toBe('PNGDATA')
  })

  it('чужой файл неотличим от отсутствующего', () => {
    const res = readUserFile(join(outside, 'secret.png'), [home])
    expect(res).toEqual({ ok: false, reason: 'not-found' })
  })

  it('каталог — не файл', () => {
    const res = readUserFile(join(home, '.codex'), [home])
    expect(res).toEqual({ ok: false, reason: 'not-a-file' })
  })
})
