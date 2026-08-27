import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAKE_SCAFFOLD } from '@voicechat/shared'
import { MakeError, MakeWorkspaces, refererHost } from './workspace'

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

  it('мок-API: отсутствующий путь → mock/<путь>[.METHOD].json, конверт статуса, публикация со снимком отдаёт мок снимка', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.write(CONV, 'mock/api/users.json', '[{"id":1}]')
    await ws.write(CONV, 'mock/api/users.POST.json', '{"$status":201,"$body":{"id":2}}')
    await ws.write(CONV, 'mock/api/broken.json', '{oops')
    expect(await ws.resolveMock(CONV, 'api/users', 'GET')).toMatchObject({ status: 200, body: [{ id: 1 }] })
    expect(await ws.resolveMock(CONV, 'api/users', 'POST')).toMatchObject({ status: 201, body: { id: 2 } })
    expect((await ws.resolveMock(CONV, 'api/broken', 'GET'))?.status).toBe(500)
    expect(await ws.resolveMock(CONV, 'api/none', 'GET')).toBeNull()
    expect(await ws.resolveMock(CONV, 'mock/api/users.json', 'GET')).toBeNull()
    const snap = (await ws.snapshot(CONV, 'v1')).snapshots[0]!
    await ws.publish(CONV, { snapshotId: snap.id })
    await ws.write(CONV, 'mock/api/users.json', '[{"id":9}]')
    expect(await ws.resolveMock(CONV, 'api/users', 'GET', true)).toMatchObject({ body: [{ id: 1 }] })
    expect(await ws.resolveMock(CONV, 'api/users', 'GET')).toMatchObject({ body: [{ id: 9 }] })
  })

  it('место и очистка: usage по составляющим, неиспользуемые ассеты, cleanup бережёт закреплённый снимок', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.writeBuffer(CONV, 'img/used.png', Buffer.from('PNG1'))
    await ws.writeBuffer(CONV, 'img/orphan.png', Buffer.from('PNG22'))
    await ws.write(CONV, 'index.html', '<img src="img/used.png">')
    const s1 = (await ws.snapshot(CONV, 's1')).snapshots[0]!
    await ws.snapshot(CONV, 's2'); await ws.snapshot(CONV, 's3')
    await ws.publish(CONV, { snapshotId: s1.id })
    const u = await ws.usage(CONV)
    expect(u.filesCount).toBe(5) // scaffold (3) + два png
    expect(u.snapshotsCount).toBe(3)
    expect(u.snapshotsBytes).toBeGreaterThan(0)
    expect(u.totalBytes).toBe(u.filesBytes + u.snapshotsBytes + u.shotsBytes)
    expect(u.unusedAssets).toEqual([{ path: 'img/orphan.png', size: 5 }])
    const r = await ws.cleanup(CONV, { keepSnapshots: 0, unusedAssets: true })
    expect(r.removed).toEqual({ snapshots: 2, shots: 0, assets: 1 })
    expect(r.freedBytes).toBeGreaterThan(0)
    expect(r.usage.snapshotsCount).toBe(1)
    expect((await ws.snapshots(CONV))[0]!.id).toBe(s1.id)
    expect(await ws.readBuffer(CONV, 'img/orphan.png')).toBeNull()
  })

  it('комментарии: добавление, решено, удаление; переживают reset', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    const list = await ws.addComment(CONV, { selector: 'h1', elementLabel: '<h1> Привет', text: '  Крупнее  ', author: 'admin' })
    expect(list[0]).toMatchObject({ selector: 'h1', text: 'Крупнее', author: 'admin', resolved: false })
    await expect(ws.addComment(CONV, { selector: '', elementLabel: '', text: 'x', author: 'a' })).rejects.toMatchObject({ code: 'invalid_path' })
    const id = list[0]!.id
    expect((await ws.updateComment(CONV, id, { resolved: true }))[0]!.resolved).toBe(true)
    await expect(ws.updateComment(CONV, 'nope', { resolved: true })).rejects.toMatchObject({ code: 'not_found' })
    await ws.reset(CONV)
    expect((await ws.comments(CONV)).length).toBe(1)
    expect(await ws.removeComment(CONV, id)).toEqual([])
  })

  it('read-only ссылка: токен один и тот же, sharedTarget, отзыв; переживает reset', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    const st = await ws.createShare(CONV)
    expect(st.shared?.url).toMatch(/^#\/make-shared\/[0-9a-f]{32}$/)
    const token = st.shared!.token
    expect((await ws.createShare(CONV)).shared?.token).toBe(token)
    expect(await ws.sharedTarget(token)).toBe(CONV)
    expect(await ws.sharedTarget('nope')).toBeNull()
    await ws.reset(CONV)
    expect((await ws.state(CONV)).shared?.token).toBe(token)
    await ws.revokeShare(CONV)
    expect(await ws.sharedTarget(token)).toBeNull()
    expect((await ws.state(CONV)).shared).toBeNull()
  })

  it('exportZip с pwa добавляет манифест, sw и иконку, а копия index.html получает ссылки; сам проект не меняется', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    const zip = (await ws.exportZip(CONV, { pwa: true })).toString('latin1')
    expect(zip).toContain('manifest.webmanifest')
    expect(zip).toContain('sw.js')
    expect(zip).toContain('icon.svg')
    expect(zip).toContain('rel="manifest"')
    expect((await ws.read(CONV, 'index.html')).content).not.toContain('rel="manifest"')
    const vite = (await ws.exportZip(CONV, { vite: true, pwa: true })).toString('latin1')
    expect(vite).toContain('public/manifest.webmanifest')
  })

  it('adminStats: сводка по проектам, владельцам и публикациям', async () => {
    const ws = await fresh()
    await ws.ensure(CONV); await ws.ensure('conv-2')
    await ws.snapshot(CONV, 's1')
    await ws.publish(CONV)
    await ws.countView(CONV)
    const stats = await ws.adminStats((id) => (id === CONV ? 'alice' : 'bob'))
    expect(stats.projects).toBe(2)
    expect(stats.published).toBe(1)
    expect(stats.views).toBe(1)
    expect(stats.bytes).toBe(stats.filesBytes + stats.snapshotsBytes + stats.shotsBytes)
    expect(stats.byUser.map((u) => u.user).sort()).toEqual(['alice', 'bob'])
    expect(stats.top[0]).toMatchObject({ conversationId: CONV, owner: 'alice', published: true, snapshots: 1 })
  })

  it('promptContext: токены из :root и открытые комментарии; пусто без того и другого', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.write(CONV, 'styles.css', 'body{margin:0}')
    expect(await ws.promptContext(CONV)).toBe('')
    await ws.write(CONV, 'styles.css', ':root { --accent: #f00; --gap: 8px; }')
    await ws.addComment(CONV, { selector: 'h1', elementLabel: '<h1> Привет', text: 'Крупнее', author: 'a' })
    const resolved = await ws.addComment(CONV, { selector: 'p', elementLabel: '<p>', text: 'Решено уже', author: 'a' })
    await ws.updateComment(CONV, resolved[0]!.id, { resolved: true })
    const ctx = await ws.promptContext(CONV)
    expect(ctx).toContain('--accent: #f00; --gap: 8px')
    expect(ctx).toContain('1. <h1> Привет (селектор `h1`): Крупнее')
    expect(ctx).not.toContain('Решено уже')
  })

  it('история публикаций: запись при смене снимка/живой, слуг и пароль историю не пополняют', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.publish(CONV)
    const s1 = (await ws.snapshot(CONV, 'v1')).snapshots[0]!
    await ws.publish(CONV, { snapshotId: s1.id })
    await ws.publish(CONV, { slug: 'my-site' })
    await ws.publish(CONV, { snapshotId: null })
    const h = (await ws.state(CONV)).published!.history!
    expect(h.map((e) => e.snapshotId)).toEqual([null, s1.id, null])
    expect(h[1]!.snapshotLabel).toBe('v1')
  })

  it('persist-коллекция мок-API: POST пишет в файл, GET по id читает, на публикации только чтение', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.write(CONV, 'mock/api/todos.json', JSON.stringify({ $collection: true, $body: [{ id: '1', text: 'a' }] }))
    const posted = await ws.resolveMock(CONV, 'api/todos', 'POST', false, { text: 'b' })
    expect(posted?.status).toBe(201)
    const saved = JSON.parse((await ws.read(CONV, 'mock/api/todos.json')).content) as { $body: Array<{ id: string }> }
    expect(saved.$body).toHaveLength(2)
    expect((await ws.resolveMock(CONV, `api/todos/${saved.$body[1]!.id}`, 'GET'))?.body).toMatchObject({ text: 'b' })
    expect((await ws.resolveMock(CONV, 'api/todos/1', 'DELETE'))?.status).toBe(204)
    await ws.publish(CONV)
    expect((await ws.resolveMock(CONV, 'api/todos', 'POST', true, { text: 'c' }))?.status).toBe(405)
    expect((await ws.resolveMock(CONV, 'api/todos', 'GET', true))?.status).toBe(200)
  })

  it('insertLibraryFiles: компоненты копируются, токены сливаются в существующий :root без затирания', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.write(CONV, 'styles.css', ':root { --accent: #f00; }\nbody { margin: 0 }')
    const { state, mergedTokens } = await ws.insertLibraryFiles(CONV, [
      { path: 'src/components/Kit.tsx', data: Buffer.from('export const Kit = () => null') },
      { path: 'styles.css', data: Buffer.from(':root { --accent: #00f; --radius: 8px; }') }
    ])
    expect(mergedTokens).toBe(1)
    expect(state.files.some((f) => f.path === 'src/components/Kit.tsx')).toBe(true)
    const css = (await ws.read(CONV, 'styles.css')).content
    expect(css).toContain('--accent: #f00')
    expect(css).toContain('--radius: 8px')
    expect(css).toContain('body { margin: 0 }')
  })

  it('квота на пользователя: сумма по проектам владельца, превышение — MakeError quota', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vc-make-'))
    const ws = new MakeWorkspaces(dir, { maxUserBytes: 3000 })
    ws.setProjectsOfOwner(() => [CONV, 'conv-2'])
    await ws.ensure(CONV); await ws.ensure('conv-2')
    const used = (await ws.usage(CONV)).totalBytes + (await ws.usage('conv-2')).totalBytes
    expect(used).toBeLessThan(3000)
    await expect(ws.write(CONV, 'big.txt', 'x'.repeat(3000 - used + 1))).rejects.toMatchObject({ code: 'quota' })
    await ws.write(CONV, 'ok.txt', 'y')
    expect((await ws.adminStats(() => 'u')).userLimitBytes).toBe(3000)
  })

  it('sweep: удаляет снимки старше 30 дней, кроме закреплённого и самого свежего; чистит старые PNG стори', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    const day = 86_400_000
    const now = Date.now()
    const old1 = (await ws.snapshot(CONV, 'old1')).snapshots[0]!
    const old2 = (await ws.snapshot(CONV, 'old2')).snapshots[0]!
    const fresh1 = (await ws.snapshot(CONV, 'fresh')).snapshots[0]!
    const dir = join((ws as unknown as { rootDir: string }).rootDir, 'make', CONV, '.snapshots')
    for (const [snap, age] of [[old1, 40], [old2, 35], [fresh1, 1]] as const) {
      const metaPath = join(dir, snap.id, 'meta.json')
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { createdAt: number }
      meta.createdAt = now - age * day
      await writeFile(metaPath, JSON.stringify(meta), 'utf8')
    }
    await ws.publish(CONV, { snapshotId: old2.id })
    const r = await ws.sweep(30 * day, now)
    expect(r).toEqual({ projects: 1, snapshots: 1, shots: 0 })
    expect((await ws.snapshots(CONV)).map((s) => s.label).sort()).toEqual(['fresh', 'old2'])
  })

  it('аналитика публикации: просмотры по дням и хостам реферера, прямые заходы без реферера', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.publish(CONV)
    const d1 = Date.UTC(2026, 7, 26, 12), d2 = Date.UTC(2026, 7, 27, 12)
    await ws.countView(CONV, 'https://news.ycombinator.com/item?id=1', d1)
    await ws.countView(CONV, null, d1)
    await ws.countView(CONV, 'not a url', d2)
    await ws.countView(CONV, 'https://t.co/x', d2)
    const pub = (await ws.state(CONV)).published!
    expect(pub.views).toBe(4)
    expect(pub.stats?.days).toEqual([{ day: '2026-08-26', views: 2 }, { day: '2026-08-27', views: 2 }])
    expect(pub.stats?.referers).toEqual([{ host: 'news.ycombinator.com', views: 1 }, { host: 't.co', views: 1 }])
    expect(refererHost('http://localhost:8787/x')).toBeNull()
  })

  it('именной доступ: setShareGrant создаёт ссылку, роли читаются, null убирает', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.setShareGrant(CONV, 'bob', 'editor')
    expect((await ws.state(CONV)).shared?.grants).toEqual([{ user: 'bob', role: 'editor' }])
    expect(await ws.shareRole(CONV, 'bob')).toBe('editor')
    await ws.setShareGrant(CONV, 'bob', 'viewer')
    expect(await ws.shareRole(CONV, 'bob')).toBe('viewer')
    await ws.setShareGrant(CONV, 'bob', null)
    expect(await ws.shareRole(CONV, 'bob')).toBeNull()
    await expect(ws.setShareGrant(CONV, 'bad name!', 'viewer')).rejects.toMatchObject({ code: 'invalid_path' })
  })

  it('applyChanges: откат всех файлов при ошибке компиляции, иначе запись; editFile — уникальный фрагмент', async () => {
    const ws = await fresh()
    await ws.ensure(CONV)
    await ws.write(CONV, 'a.txt', 'old-a')
    const bad = await ws.applyChanges(CONV, [{ path: 'a.txt', content: 'new-a' }, { path: 'src/x.tsx', content: 'export const X = () => <div>' }])
    expect(bad.rolledBack).toBe(true)
    expect((await ws.read(CONV, 'a.txt')).content).toBe('old-a')
    expect(await ws.readBuffer(CONV, 'src/x.tsx')).toBeNull()
    const ok = await ws.applyChanges(CONV, [{ path: 'a.txt', content: 'new-a' }], ['styles.css'])
    expect(ok.rolledBack).toBe(false)
    expect((await ws.read(CONV, 'a.txt')).content).toBe('new-a')
    expect(await ws.readBuffer(CONV, 'styles.css')).toBeNull()
    await ws.write(CONV, 'b.txt', 'x y x')
    await expect(ws.editFile(CONV, 'b.txt', 'x', 'z')).rejects.toMatchObject({ code: 'exists' })
    await expect(ws.editFile(CONV, 'b.txt', 'nope', 'z')).rejects.toMatchObject({ code: 'not_found' })
    expect((await ws.editFile(CONV, 'b.txt', 'x', 'z', true)).replaced).toBe(2)
    expect((await ws.read(CONV, 'b.txt')).content).toBe('z y z')
    expect((await ws.editFile(CONV, 'b.txt', 'y', 'w')).replaced).toBe(1)
  })
})
