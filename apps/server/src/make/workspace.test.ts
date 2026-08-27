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

  it('публикация: токен, индекс токен→разговор, снятие; файл публикации переживает reset', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    const pub = await ws.publish(CONV)
    expect(pub.published?.url).toMatch(/^\/p\/[0-9a-f]{32}\/$/)
    const token = pub.published!.token
    expect(await ws.publishedTarget(token)).toBe(CONV)
    expect(await ws.publishedTarget('nope')).toBeNull()
    // Повторная публикация не меняет ссылку.
    expect((await ws.publish(CONV)).published?.token).toBe(token)
    await ws.reset(CONV)
    expect((await ws.state(CONV)).published?.token).toBe(token)
    const off = await ws.unpublish(CONV)
    expect(off.published).toBeNull()
    expect(await ws.publishedTarget(token)).toBeNull()
  })

  it('check находит отсутствующий index, битые ссылки, пустые файлы и http-скрипты', async () => {
    const ws = await fresh()
    await ws.write(CONV, 'about.html', '<link href="css/x.css"><script src="http://cdn/x.js"></script><a href="#top">a</a><img src="data:image/png;base64,xx">')
    await ws.write(CONV, 'empty.js', '')
    const issues = await ws.check(CONV)
    expect(issues.map((i) => i.kind).sort()).toEqual(['empty-file', 'external-script', 'missing-file', 'no-index'])
    await ws.write(CONV, 'index.html', '<link rel="stylesheet" href="css/x.css">')
    await ws.write(CONV, 'css/x.css', 'body{background:url(../img/bg.png)} .f{filter:url(#shadow)}')
    const again = await ws.check(CONV)
    expect(again.some((i) => i.kind === 'no-index')).toBe(false)
    expect(again.filter((i) => i.kind === 'missing-file').map((i) => i.message)).toContain('Ссылка на отсутствующий файл: ../img/bg.png')
  })

  it('snapshotDiff/restoreFile: статусы файлов и возврат одного файла', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.write(CONV, 'index.html', 'v1')
    const snap = (await ws.snapshot(CONV, 's')).snapshots[0]!
    await ws.write(CONV, 'index.html', 'v2-changed')
    await ws.write(CONV, 'new.js', '1')
    await ws.delete(CONV, 'app.js')
    const diff = await ws.snapshotDiff(CONV, snap.id)
    const by = Object.fromEntries(diff.files.map((f) => [f.path, f.status]))
    expect(by).toMatchObject({ 'index.html': 'changed', 'new.js': 'added', 'app.js': 'removed', 'styles.css': 'same' })
    await ws.restoreFile(CONV, snap.id, 'index.html')
    expect((await ws.read(CONV, 'index.html')).content).toBe('v1')
    expect((await ws.list(CONV)).map((f) => f.path)).toContain('new.js')
    await expect(ws.restoreFile(CONV, snap.id, 'nope.txt')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('importFiles: replace очищает, merge дописывает; снимок перед импортом; exportZip с vite добавляет package.json', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.importFiles(CONV, [{ path: 'index.html', data: Buffer.from('<h1>imp</h1>') }, { path: 'src/a.jsx', data: Buffer.from('export const A = 1') }, { path: '../evil', data: Buffer.from('x') }], 'replace')
    expect((await ws.list(CONV)).map((f) => f.path)).toEqual(['index.html', 'src/a.jsx'])
    expect((await ws.snapshots(CONV)).map((s) => s.label)).toContain('Перед импортом (замена)')
    await ws.importFiles(CONV, [{ path: 'extra.css', data: Buffer.from('b{}') }], 'merge')
    expect((await ws.list(CONV)).map((f) => f.path)).toContain('index.html')
    const zip = (await ws.exportZip(CONV, { vite: true })).toString('latin1')
    expect(zip).toContain('package.json')
    expect(zip).toContain('@vitejs/plugin-react')
    expect(zip).toContain('vite.config.js')
    expect((await ws.exportZip(CONV)).toString('latin1')).not.toContain('package.json')
  })

  it('check: синтаксическая ошибка в .tsx → compile-error со строкой', async () => {
    const ws = await fresh()
    await ws.write(CONV, 'index.html', '<script type="module" src="src/a.tsx"></script>')
    await ws.write(CONV, 'src/a.tsx', 'export const A = () => <div>\n  <b>x</b\n')
    const issues = await ws.check(CONV)
    const compile = issues.find((i) => i.kind === 'compile-error')
    expect(compile).toBeDefined()
    expect(compile!.path).toBe('src/a.tsx')
    expect(compile!.line).toBeGreaterThanOrEqual(1)
    await ws.write(CONV, 'src/a.tsx', 'export const A = () => <div><b>x</b></div>\n')
    expect((await ws.check(CONV)).some((i) => i.kind === 'compile-error')).toBe(false)
  })

  it('applyTemplate заменяет файлы шаблоном и сохраняет снимок; неизвестный шаблон — not_found', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    const state = await ws.applyTemplate(CONV, 'dashboard')
    expect(state.files.map((f) => f.path)).toEqual(['app.js', 'index.html', 'styles.css'])
    expect((await ws.read(CONV, 'index.html')).content).toContain('Дашборд')
    expect(state.snapshots.map((s) => s.label)).toContain('Перед шаблоном «Дашборд»')
    await expect(ws.applyTemplate(CONV, 'nope')).rejects.toMatchObject({ code: 'not_found' })
  })
})
