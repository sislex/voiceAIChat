import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_AGENT_POLICY, type AgentPolicy } from '@voicechat/shared'
import { fsList, fsRead, fsWrite, fsDelete, fsRename, fsMkdir } from './fileOps'

const OPEN: AgentPolicy = { ...DEFAULT_AGENT_POLICY }

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vc-fs-'))
  writeFileSync(join(root, 'a.txt'), 'привет')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('fileOps', () => {
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
})
