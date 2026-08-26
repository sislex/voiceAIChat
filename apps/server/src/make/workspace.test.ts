import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAKE_SCAFFOLD } from '@voicechat/shared'
import { MakeError, MakeWorkspaces } from './workspace'

const CONV = 'conv-1'

async function fresh(): Promise<MakeWorkspaces> {
  return new MakeWorkspaces(await mkdtemp(join(tmpdir(), 'vc-make-')))
}

describe('MakeWorkspaces', () => {
  it('ensure создаёт заготовку один раз; повторный ensure не трогает файлы', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    expect((await ws.list(CONV)).map((f) => f.path)).toEqual(Object.keys(MAKE_SCAFFOLD).sort())
    await ws.write(CONV, 'index.html', '<h1>hi</h1>')
    await ws.ensure(CONV)
    expect((await ws.read(CONV, 'index.html')).content).toBe('<h1>hi</h1>')
  })

  it('write/read/rename/delete с подкаталогами, rev растёт, пустые каталоги убираются', async () => {
    const ws = await fresh()
    expect(ws.rev(CONV)).toBe(0)
    await ws.write(CONV, 'css/app.css', 'body{}')
    expect(ws.rev(CONV)).toBe(1)
    expect((await ws.read(CONV, './css/app.css')).content).toBe('body{}')
    await ws.rename(CONV, 'css/app.css', 'styles/main.css')
    expect((await ws.list(CONV)).map((f) => f.path)).toEqual(['styles/main.css'])
    const state = await ws.delete(CONV, 'styles/main.css')
    expect(state.files).toEqual([])
    expect(state.rev).toBe(3)
  })

  it('отвергает выход за корень, скрытые пути, символические ссылки и не-текст', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await expect(ws.write(CONV, '../evil.txt', 'x')).rejects.toMatchObject({ code: 'invalid_path' })
    await expect(ws.read(CONV, '.snapshots/meta.json')).rejects.toMatchObject({ code: 'invalid_path' })
    await expect(ws.read(CONV, 'nope.html')).rejects.toMatchObject({ code: 'not_found' })
    await expect(ws.read(CONV, 'logo.png')).rejects.toMatchObject({ code: 'not_text' })
    await expect(() => ws.dirOf('../x')).toThrow(MakeError)
    // Ссылка на каталог вне проекта не должна открывать доступ наружу.
    const outside = await mkdtemp(join(tmpdir(), 'vc-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'top')
    await symlink(outside, join(ws.dirOf(CONV), 'link'))
    await expect(ws.read(CONV, 'link/secret.txt')).rejects.toMatchObject({ code: 'invalid_path' })
  })

  it('лимиты: размер файла и число файлов', async () => {
    const ws = await fresh()
    await expect(ws.write(CONV, 'big.txt', 'x'.repeat(2 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'too_large' })
  })

  it('снимки: создание, откат (с авто-снимком текущего), сброс к заготовке', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.write(CONV, 'index.html', 'v1')
    const s1 = await ws.snapshot(CONV, 'первая')
    expect(s1.snapshots).toHaveLength(1)
    await ws.write(CONV, 'index.html', 'v2')
    await ws.write(CONV, 'extra.js', 'x')
    const restored = await ws.restore(CONV, s1.snapshots[0]!.id)
    expect((await ws.read(CONV, 'index.html')).content).toBe('v1')
    expect(restored.files.map((f) => f.path)).not.toContain('extra.js')
    // Перед откатом сохранилось текущее состояние.
    expect(restored.snapshots.map((s) => s.label)).toContain('Перед восстановлением снимка')
    await expect(ws.restore(CONV, 'missing')).rejects.toMatchObject({ code: 'not_found' })
    const reset = await ws.reset(CONV)
    expect((await ws.read(CONV, 'index.html')).content).toBe(MAKE_SCAFFOLD['index.html'])
    expect(reset.snapshots.map((s) => s.label)).toContain('Перед сбросом проекта')
  })

  it('exportZip собирает валидный архив со всеми файлами', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    const zip = await ws.exportZip(CONV)
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.toString('latin1')).toContain('index.html')
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50)
  })
})
