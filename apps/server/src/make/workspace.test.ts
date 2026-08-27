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
    // Закрепление за снимком: publicFile отдаёт файлы снимка, а не текущие; повторный publish без snapshotId — живая.
    await ws.write(CONV, 'index.html', 'live-v1')
    const snap = (await ws.snapshot(CONV, 'релиз 1')).snapshots[0]!
    await ws.write(CONV, 'index.html', 'live-v2')
    const pinned = await ws.publish(CONV, { snapshotId: snap.id })
    expect(pinned.published).toMatchObject({ token, snapshotId: snap.id, snapshotLabel: 'релиз 1' })
    expect((await ws.publicFile(CONV, 'index.html'))!.data.toString()).toBe('live-v1')
    await ws.publish(CONV)
    expect((await ws.publicFile(CONV, 'index.html'))!.data.toString()).toBe('live-v2')
    await expect(ws.publish(CONV, { snapshotId: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
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

  it('addShot: PNG сохраняется, meta сортирована, лимит 10 на стори с удалением файлов', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(8)])
    for (let i = 0; i < 12; i++) await ws.addShot(CONV, 'src/B.stories.tsx', 'Primary', png)
    await ws.addShot(CONV, 'src/B.stories.tsx', 'Small', png)
    const shots = await ws.shots(CONV)
    expect(shots.filter((s) => s.story === 'Primary')).toHaveLength(10)
    expect(shots.filter((s) => s.story === 'Small')).toHaveLength(1)
    expect((await ws.shotImage(CONV, shots[0]!.id))!.equals(png)).toBe(true)
    await expect(ws.addShot(CONV, 'a', 'b', Buffer.from('notpng'))).rejects.toMatchObject({ code: 'invalid_path' })
    // .shots не считается файлом проекта и переживает reset
    expect((await ws.list(CONV)).some((f) => f.path.includes('.shots'))).toBe(false)
    await ws.reset(CONV)
    expect(await ws.shots(CONV)).toHaveLength(11)
  })

  it('replaceAll: замена во всех текстовых файлах без регистра, снимок перед заменой, без совпадений — ничего', async () => {
    const ws = await fresh()
    await ws.write(CONV, 'index.html', '<h1>Hello</h1><p>hello world</p>')
    await ws.write(CONV, 'css/a.css', '.hello{}')
    await ws.write(CONV, 'logo.png', 'hello-binary')
    const r = await ws.replaceAll(CONV, 'hello', 'Привет')
    expect(r).toMatchObject({ files: 2, replacements: 3 })
    expect((await ws.read(CONV, 'index.html')).content).toBe('<h1>Привет</h1><p>Привет world</p>')
    expect((await ws.snapshots(CONV))[0]!.label).toContain('Перед заменой')
    const none = await ws.replaceAll(CONV, 'nothing-here', 'x')
    expect(none.files).toBe(0)
    expect(await ws.snapshots(CONV)).toHaveLength(1)
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
    expect((await ws.snapshotFile(CONV, snap.id, 'index.html')).content).toBe('v1')
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

  it('публикация: slug → токен, пароль и пропуск, счётчик просмотров, снятие чистит индекс slug', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.ensure('conv-2')
    const st = await ws.publish(CONV, { slug: 'My-Site', password: 'secret1' })
    expect(st.published).toMatchObject({ slug: 'my-site', slugUrl: '/s/my-site/', passwordProtected: true, views: 0 })
    const token = st.published!.token
    expect(await ws.slugToken('my-site')).toBe(token)
    expect(await ws.slugToken('nope')).toBeNull()
    await expect(ws.publish(CONV, { slug: 'bad slug!' })).rejects.toMatchObject({ code: 'invalid_path' })
    await expect(ws.publish(CONV, { slug: 'api' })).rejects.toMatchObject({ code: 'invalid_path' })
    await ws.publish('conv-2')
    await expect(ws.publish('conv-2', { slug: 'my-site' })).rejects.toMatchObject({ code: 'exists' })
    expect(await ws.verifyPublicPassword(CONV, 'secret1')).toBe(true)
    expect(await ws.verifyPublicPassword(CONV, 'wrong')).toBe(false)
    const gate1 = await ws.publicGate(CONV)
    expect(gate1).toMatch(/^[0-9a-f]{64}$/)
    await ws.publish(CONV, {})
    expect(await ws.publicGate(CONV)).toBe(gate1)
    await ws.publish(CONV, { password: 'secret2' })
    expect(await ws.publicGate(CONV)).not.toBe(gate1)
    await ws.publish(CONV, { password: null })
    expect(await ws.publicGate(CONV)).toBeNull()
    expect((await ws.state(CONV)).published?.passwordProtected).toBe(false)
    await ws.countView(CONV); await ws.countView(CONV)
    expect((await ws.state(CONV)).published?.views).toBe(2)
    await ws.publish(CONV, { slug: 'other' })
    expect(await ws.slugToken('my-site')).toBeNull()
    expect(await ws.slugToken('other')).toBe(token)
    await ws.unpublish(CONV)
    expect(await ws.slugToken('other')).toBeNull()
  })
})
