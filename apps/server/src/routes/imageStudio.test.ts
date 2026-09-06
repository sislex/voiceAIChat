// Студия картинок: галерея, загрузка, генерация и правка по промпту.
// Генератор — фейк: важен контракт роутов (доступ, имена, квоты, новые файлы
// при правке), а не сам вызов LLM.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { VoiceChatDb } from '../db/database.js'
import { ImageStudioStore } from '../images/studio.js'
import { registerImageStudioRoutes } from './imageStudio.js'


/** Байты валидного однопиксельного PNG — sniffing в store пропускает только настоящие картинки. */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('фикстура-остаток')
])

const U = 'admin'
let app: FastifyInstance
let db: VoiceChatDb
let store: ImageStudioStore
let dir: string
let convId: string
let generated: Array<{ prompt: string; hasSource: boolean }>

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'img-routes-'))
  db = new VoiceChatDb(':memory:')
  db.createUser(U, '', 'admin')
  store = new ImageStudioStore(dir)
  convId = db.createConversation(U, 'Студия', 'images')!.id
  generated = []
  app = Fastify()
  app.decorateRequest('user', null)
  app.addHook('preHandler', async (req) => { (req as unknown as { user: { name: string } }).user = { name: U } })
  registerImageStudioRoutes(app, {
    db, store,
    generator: () => async ({ prompt, source }) => {
      generated.push({ prompt, hasSource: Boolean(source) })
      return Buffer.concat([PNG_BYTES, Buffer.from(prompt)])
    }
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('студия картинок: роуты', () => {
  it('галерея: загрузка, чтение с mime, переименование, удаление', async () => {
    const up = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/file`, payload: { path: 'логотип.png', dataBase64: PNG_BYTES.toString('base64') } })
    expect(up.statusCode).toBe(200)
    expect(up.json().map((file: { path: string }) => file.path)).toEqual(['логотип.png'])

    const read = await app.inject({ method: 'GET', url: `/api/image-studio/${convId}/file?path=${encodeURIComponent('логотип.png')}` })
    expect(read.headers['content-type']).toContain('image/png')
    expect(read.rawPayload.equals(PNG_BYTES)).toBe(true)

    await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/rename`, payload: { from: 'логотип.png', to: 'лого.png' } })
    const del = await app.inject({ method: 'DELETE', url: `/api/image-studio/${convId}/file?path=${encodeURIComponent('лого.png')}` })
    expect(del.json()).toEqual([])
  })

  it('generate рисует по промпту и не затирает существующие имена', async () => {
    await store.writeBuffer(convId, 'изображение.png', Buffer.concat([PNG_BYTES, Buffer.from('старое')]))
    const res = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'кот в очках' } })
    expect(res.statusCode).toBe(200)
    // Имя по умолчанию занято — новая картинка получила суффикс, старая цела.
    expect(res.json().file.path).toBe('изображение-2.png')
    expect((await store.readBuffer(convId, 'изображение.png'))!.toString()).toContain('старое')
    expect(generated).toEqual([{ prompt: 'кот в очках', hasSource: false }])
  })

  it('edit правит по промпту в новый файл, оригинал не трогается', async () => {
    await store.writeBuffer(convId, 'кот.png', Buffer.concat([PNG_BYTES, Buffer.from('оригинал')]))
    const res = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/edit`, payload: { path: 'кот.png', prompt: 'добавь шляпу' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().file.path).toBe('кот-2.png')
    expect((await store.readBuffer(convId, 'кот.png'))!.toString()).toContain('оригинал')
    expect(generated).toEqual([{ prompt: 'добавь шляпу', hasSource: true }])
  })

  it('пустой промпт — 400 словами; обычный чат — 404', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: '  ' } })).statusCode).toBe(400)
    const plain = db.createConversation(U, 'Обычный')!.id
    expect((await app.inject({ method: 'GET', url: `/api/image-studio/${plain}/files` })).statusCode).toBe(404)
  })
})

describe('студия картинок: параллельность, отмена и происхождение', () => {
  it('второй ран по тому же разговору — 409, после завершения снова можно', async () => {
    // Генератор, который завершится по нашей команде.
    let finish: ((data: Buffer) => void) | undefined
    const slowApp = Fastify()
    slowApp.decorateRequest('user', null)
    slowApp.addHook('preHandler', async (req) => { (req as unknown as { user: { name: string } }).user = { name: U } })
    registerImageStudioRoutes(slowApp, {
      db, store,
      generator: () => () => new Promise((resolve) => { finish = resolve })
    })
    await slowApp.ready()

    // inject без await ленивый — .then заставляет запрос уйти прямо сейчас.
    const first = slowApp.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'кот' } }).then((res) => res)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = await slowApp.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'пёс' } })
    expect(second.statusCode).toBe(409)
    expect(second.json().error).toMatch(/уже идёт/)

    finish!(PNG_BYTES)
    expect((await first).statusCode).toBe(200)
    // Слот освободился: третий ран принимается (и тоже ждёт «медленную» модель).
    const third = slowApp.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'ещё' } }).then((res) => res)
    await new Promise((resolve) => setTimeout(resolve, 20))
    finish!(PNG_BYTES)
    expect((await third).statusCode).toBe(200)
    await slowApp.close()
  })

  it('cancel останавливает ран: клиент получает 410, генератору дёрнули cancel', async () => {
    let cancelCalls = 0
    const slowApp = Fastify()
    slowApp.decorateRequest('user', null)
    slowApp.addHook('preHandler', async (req) => { (req as unknown as { user: { name: string } }).user = { name: U } })
    registerImageStudioRoutes(slowApp, {
      db, store,
      generator: () => ({ onCancel }) => new Promise((_, reject) => {
        onCancel?.(() => { cancelCalls += 1; reject(new Error('cancelled')) })
      })
    })
    await slowApp.ready()

    const running = slowApp.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'долгий кот' } }).then((res) => res)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const cancel = await slowApp.inject({ method: 'POST', url: `/api/image-studio/${convId}/cancel` })
    expect(cancel.json()).toEqual({ cancelled: true })
    const result = await running
    expect(result.statusCode).toBe(410)
    expect(result.json().error).toMatch(/отменена/)
    expect(cancelCalls).toBe(1)
    // Без активного рана отмена честно говорит «нечего отменять».
    expect((await slowApp.inject({ method: 'POST', url: `/api/image-studio/${convId}/cancel` })).json()).toEqual({ cancelled: false })
    await slowApp.close()
  })

  it('generate/edit пишут происхождение, rename его переносит', async () => {
    const gen = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'синий кит', name: 'кит.png' } })
    expect(gen.json().file.prompt).toBe('синий кит')
    // Длительность рана — в мете и в списке.
    const listed = (await app.inject({ method: 'GET', url: `/api/image-studio/${convId}/files` })).json() as Array<{ path: string; tookMs?: number }>
    expect(listed.find((file) => file.path === 'кит.png')?.tookMs).toBeGreaterThanOrEqual(0)

    const edit = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/edit`, payload: { path: 'кит.png', prompt: 'добавь фонтан' } })
    expect(edit.json().file).toMatchObject({ path: 'кит-2.png', prompt: 'добавь фонтан', source: 'кит.png' })

    await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/rename`, payload: { from: 'кит-2.png', to: 'кит-фонтан.png' } })
    const list = (await app.inject({ method: 'GET', url: `/api/image-studio/${convId}/files` })).json() as Array<{ path: string; prompt?: string; source?: string }>
    const renamed = list.find((file) => file.path === 'кит-фонтан.png')
    expect(renamed).toMatchObject({ prompt: 'добавь фонтан', source: 'кит.png' })
    // Служебный sidecar не отдаётся списком.
    expect(list.some((file) => file.path.includes('.studio-meta'))).toBe(false)
  })
})

describe('студия картинок: публикация галереи', () => {
  it('публикация выдаёт ссылку, страница и файлы отдаются без авторизации, снятие гасит', async () => {
    await store.writeBuffer(convId, 'кот.png', Buffer.concat([PNG_BYTES, Buffer.from('кот')]))
    await store.setMeta(convId, 'кот.png', { prompt: 'рыжий кот' })

    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json() as { url: string }
    expect(pub.url).toMatch(/^\/g\/[0-9a-f]{32}\/$/)
    // Повторная публикация не ротирует ссылку.
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json().url).toBe(pub.url)

    const page = await app.inject({ method: 'GET', url: pub.url })
    expect(page.statusCode).toBe(200)
    expect(page.headers['x-robots-tag']).toBe('noindex')
    expect(page.body).toContain('кот.png')
    expect(page.body).toContain('рыжий кот')

    const file = await app.inject({ method: 'GET', url: `${pub.url}file?path=${encodeURIComponent('кот.png')}` })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toMatch(/image\/png/)

    // Статистика просмотров дошла до владельца. Счётчик страницы фоновый —
    // ждём очередь публикации, иначе на медленной машине читаем ноль.
    await store.publishSettled(convId)
    const info = (await app.inject({ method: 'GET', url: `/api/image-studio/${convId}/publication` })).json() as { views: number }
    expect(info.views).toBeGreaterThanOrEqual(1)

    await app.inject({ method: 'DELETE', url: `/api/image-studio/${convId}/publish` })
    expect((await app.inject({ method: 'GET', url: pub.url })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `${pub.url}file?path=${encodeURIComponent('кот.png')}` })).statusCode).toBe(404)
  })

  it('чужой или не-студийный чат публиковать нельзя', async () => {
    const plain = db.createConversation(U, 'Обычный')
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${plain.id}/publish` })).statusCode).toBe(404)
  })

  it('переопубликация после снятия не воскрешается фоновым счётчиком', async () => {
    await store.writeBuffer(convId, 'кот.png', PNG_BYTES)
    for (let round = 0; round < 10; round += 1) {
      const first = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json() as { url: string }
      void store.countView(convId)
      await app.inject({ method: 'DELETE', url: `/api/image-studio/${convId}/publish` })
      const second = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json() as { url: string }
      expect(second.url).not.toBe(first.url)
      expect((await app.inject({ method: 'GET', url: second.url })).statusCode).toBe(200)
      await app.inject({ method: 'DELETE', url: `/api/image-studio/${convId}/publish` })
    }
  })
})

describe('студия картинок: статус рана', () => {
  it('/run показывает активный ран и его завершение', async () => {
    let finish: ((data: Buffer) => void) | undefined
    const slowApp = Fastify()
    slowApp.decorateRequest('user', null)
    slowApp.addHook('preHandler', async (req) => { (req as unknown as { user: { name: string } }).user = { name: U } })
    registerImageStudioRoutes(slowApp, {
      db, store,
      generator: () => () => new Promise((resolve) => { finish = resolve })
    })
    await slowApp.ready()

    expect((await slowApp.inject({ method: 'GET', url: `/api/image-studio/${convId}/run` })).json()).toEqual({ active: false })
    const running = slowApp.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'кот' } }).then((res) => res)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect((await slowApp.inject({ method: 'GET', url: `/api/image-studio/${convId}/run` })).json()).toEqual({ active: true })
    finish!(PNG_BYTES)
    await running
    expect((await slowApp.inject({ method: 'GET', url: `/api/image-studio/${convId}/run` })).json()).toEqual({ active: false })
    await slowApp.close()
  })
})

describe('студия картинок: пароль публикации', () => {
  it('страница и файлы закрыты формой, верный пароль открывает cookie-гейтом', async () => {
    await store.writeBuffer(convId, 'кот.png', PNG_BYTES)
    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish`, payload: { password: 'секрет' } })).json() as { url: string; passwordProtected: boolean }
    expect(pub.passwordProtected).toBe(true)

    const gated = await app.inject({ method: 'GET', url: pub.url })
    expect(gated.statusCode).toBe(401)
    expect(gated.body).toContain('защищена паролем')
    expect((await app.inject({ method: 'GET', url: `${pub.url}file?path=${encodeURIComponent('кот.png')}` })).statusCode).toBe(401)

    const wrong = await app.inject({ method: 'POST', url: `${pub.url}__auth__`, payload: 'password=нет', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(wrong.headers.location).toContain('wrong=1')

    const ok = await app.inject({ method: 'POST', url: `${pub.url}__auth__`, payload: `password=${encodeURIComponent('секрет')}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    const cookie = String(ok.headers['set-cookie']).split(';')[0]!
    expect((await app.inject({ method: 'GET', url: pub.url, headers: { cookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `${pub.url}file?path=${encodeURIComponent('кот.png')}`, headers: { cookie } })).statusCode).toBe(200)

    // Снятие пароля повторной публикацией: страница снова открыта всем, ссылка та же.
    const open = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish`, payload: { password: null } })).json() as { url: string; passwordProtected: boolean }
    expect(open.url).toBe(pub.url)
    expect(open.passwordProtected).toBe(false)
    expect((await app.inject({ method: 'GET', url: pub.url })).statusCode).toBe(200)
  })

  it('короткий пароль отклоняется, заголовок страницы — название чата', async () => {
    await store.writeBuffer(convId, 'кот.png', PNG_BYTES)
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish`, payload: { password: '123' } })).statusCode).toBe(400)
    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json() as { url: string }
    const page = await app.inject({ method: 'GET', url: pub.url })
    expect(page.body).toContain('Студия')
  })
})

describe('студия картинок: референсы генерации', () => {
  it('generate с references читает выбранные файлы и передаёт их генератору', async () => {
    await store.writeBuffer(convId, 'стиль-1.png', Buffer.concat([PNG_BYTES, Buffer.from('a')]))
    await store.writeBuffer(convId, 'стиль-2.png', Buffer.concat([PNG_BYTES, Buffer.from('b')]))
    let seenRefs: string[] = []
    const refApp = Fastify()
    refApp.decorateRequest('user', null)
    refApp.addHook('preHandler', async (req) => { (req as unknown as { user: { name: string } }).user = { name: U } })
    registerImageStudioRoutes(refApp, {
      db, store,
      generator: () => async ({ references }) => {
        seenRefs = (references ?? []).map((ref) => ref.name)
        return PNG_BYTES
      }
    })
    await refApp.ready()
    const res = await refApp.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'плакат', references: ['стиль-1.png', 'стиль-2.png'] } })
    expect(res.statusCode).toBe(200)
    expect(seenRefs).toEqual(['стиль-1.png', 'стиль-2.png'])
    // Несуществующий референс — честный 404, а не молчаливый пропуск.
    const missing = await refApp.inject({ method: 'POST', url: `/api/image-studio/${convId}/generate`, payload: { prompt: 'плакат', references: ['нет.png'] } })
    expect(missing.statusCode).toBe(404)
    await refApp.close()
  })
})

describe('студия картинок: автоназвание чата', () => {
  it('первый промпт переименовывает дефолтные «Картинки N», своё имя не трогается', async () => {
    const auto = db.createConversation(U, 'Картинки 3', 'images')
    await app.inject({ method: 'POST', url: `/api/image-studio/${auto.id}/generate`, payload: { prompt: 'синий кит в облаках' } })
    expect(db.getConversation(U, auto.id)?.title).toBe('Картинки: синий кит в облаках')
    // Повторная генерация не перезатирает уже говорящее имя.
    await app.inject({ method: 'POST', url: `/api/image-studio/${auto.id}/generate`, payload: { prompt: 'другое' } })
    expect(db.getConversation(U, auto.id)?.title).toBe('Картинки: синий кит в облаках')

    const named = db.createConversation(U, 'Мой альбом', 'images')
    await app.inject({ method: 'POST', url: `/api/image-studio/${named.id}/generate`, payload: { prompt: 'кот' } })
    expect(db.getConversation(U, named.id)?.title).toBe('Мой альбом')
  })
})

describe('студия картинок: происхождение клиентских обработок', () => {
  it('upload с source пишет мету — цепочка версий не рвётся', async () => {
    await store.writeBuffer(convId, 'кот.png', PNG_BYTES)
    const up = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/file`, payload: { path: 'кот-кроп.png', dataBase64: PNG_BYTES.toString('base64'), source: 'кот.png' } })
    expect(up.statusCode).toBe(200)
    const list = (await app.inject({ method: 'GET', url: `/api/image-studio/${convId}/files` })).json() as Array<{ path: string; source?: string }>
    expect(list.find((file) => file.path === 'кот-кроп.png')).toMatchObject({ source: 'кот.png' })
  })
})

describe('студия картинок: перенос между чатами', () => {
  it('move уносит файл с метой, copy оставляет оригинал; чужой чат — 404', async () => {
    const target = db.createConversation(U, 'Картинки 9', 'images')
    await store.writeBuffer(convId, 'кот.png', PNG_BYTES)
    await store.setMeta(convId, 'кот.png', { prompt: 'рыжий кот' })

    const moved = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/transfer`, payload: { path: 'кот.png', to: target.id } })
    expect(moved.statusCode).toBe(200)
    expect((moved.json() as { files: unknown[] }).files).toEqual([])
    const inTarget = await store.list(target.id)
    expect(inTarget).toHaveLength(1)
    expect(inTarget[0]).toMatchObject({ path: 'кот.png', prompt: 'рыжий кот' })

    // copy: файл остаётся, в целевом — второй экземпляр со свободным именем.
    const back = await app.inject({ method: 'POST', url: `/api/image-studio/${target.id}/transfer`, payload: { path: 'кот.png', to: convId, copy: true } })
    expect(back.statusCode).toBe(200)
    expect(await store.list(target.id)).toHaveLength(1)
    expect((await store.list(convId)).map((f) => f.path)).toContain('кот.png')

    const plain = db.createConversation(U, 'Обычный')
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/transfer`, payload: { path: 'кот.png', to: plain.id } })).statusCode).toBe(404)
  })
})

describe('студия картинок: статистика просмотров', () => {
  it('просмотры пишутся по дням, publication отдаёт сводку за 7 дней', async () => {
    await store.writeBuffer(convId, 'кот.png', PNG_BYTES)
    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json() as { url: string }
    await app.inject({ method: 'GET', url: pub.url })
    await app.inject({ method: 'GET', url: pub.url })
    // countView — фоновый: дождаться очереди лока.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const info = (await app.inject({ method: 'GET', url: `/api/image-studio/${convId}/publication` })).json() as { views: number; views7: number }
    expect(info.views).toBeGreaterThanOrEqual(2)
    expect(info.views7).toBeGreaterThanOrEqual(2)
  })
})

describe('студия картинок: OG-мета публичной страницы', () => {
  it('страница несёт og:title и og:image первой картинки', async () => {
    await store.writeBuffer(convId, 'обложка.png', PNG_BYTES)
    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json() as { url: string }
    const page = await app.inject({ method: 'GET', url: pub.url, headers: { host: 'studio.test' } })
    expect(page.body).toContain('property="og:title"')
    expect(page.body).toContain(`og:image" content="http://studio.test${pub.url}file?path=`)
  })
})

describe('студия картинок: пароль публичной галереи', () => {
  it('перебор пароля упирается в лимит попыток', async () => {
    await store.writeBuffer(convId, 'тайна.png', PNG_BYTES)
    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish`, payload: { password: 'верный' } })).json() as { url: string }
    const token = pub.url.split('/').filter(Boolean)[1]!

    // Десять промахов — это ещё редирект «пароль не подошёл».
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const miss = await app.inject({ method: 'POST', url: `/g/${token}/__auth__`, payload: { password: 'мимо' } })
      expect(miss.statusCode).toBe(302)
    }
    // Одиннадцатая попытка — отказ со сроком ожидания: иначе пароль просто перебирают.
    const blocked = await app.inject({ method: 'POST', url: `/g/${token}/__auth__`, payload: { password: 'мимо' } })
    expect(blocked.statusCode).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    expect(blocked.body).toContain('Слишком много попыток')

    // Даже верный пароль ждёт окончания окна — счёт идёт по попыткам, а не по промахам.
    expect((await app.inject({ method: 'POST', url: `/g/${token}/__auth__`, payload: { password: 'верный' } })).statusCode).toBe(429)
  })
})

describe('студия картинок: публичная страница', () => {
  it('от дюжины файлов появляется поиск по имени, вес галереи — в заголовке', async () => {
    for (let index = 0; index < 12; index += 1) await store.writeBuffer(convId, `кадр-${index}.png`, PNG_BYTES)
    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json() as { url: string }
    const page = await app.inject({ method: 'GET', url: pub.url, headers: { host: 'studio.test' } })

    // Сотню кадров иначе листают руками: фильтр работает на самой странице.
    expect(page.body).toContain('role="search"')
    expect(page.body).toContain('data-name="кадр-0.png"')
    expect(page.body).toContain('12 файлов')
    expect(page.body).toContain('<main class="grid">')
  })

  it('файл галереи отдаётся с ETag и отвечает 304 на повторный запрос', async () => {
    await store.writeBuffer(convId, 'кадр.png', PNG_BYTES)
    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json() as { url: string }
    const url = `${pub.url}file?path=${encodeURIComponent('кадр.png')}`

    const first = await app.inject({ method: 'GET', url })
    expect(first.statusCode).toBe(200)
    const etag = first.headers.etag as string
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/)
    // `no-store` заставлял качать всю галерею заново на каждой прокрутке.
    expect(first.headers['cache-control']).toBe('private, no-cache')

    // Прямую ссылку на кадр достаточно один раз опубликовать, чтобы он ушёл
    // в поиск по картинкам мимо приватности токена.
    expect(first.headers['x-robots-tag']).toBe('noindex, noimageindex')

    const again = await app.inject({ method: 'GET', url, headers: { 'if-none-match': etag } })
    expect(again.statusCode).toBe(304)
    expect(again.body).toBe('')

    // Файл заменили под тем же именем — ETag меняется, и браузер получит новое тело.
    await store.writeBuffer(convId, 'кадр.png', Buffer.concat([PNG_BYTES, Buffer.from([0])]))
    const changed = await app.inject({ method: 'GET', url, headers: { 'if-none-match': etag } })
    expect(changed.statusCode).toBe(200)
    expect(changed.headers.etag).not.toBe(etag)
  })

  it('поле пароля названо для читалки, а не только placeholder', async () => {
    await store.writeBuffer(convId, 'тайна.png', PNG_BYTES)
    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish`, payload: { password: 'слово' } })).json() as { url: string }
    const page = await app.inject({ method: 'GET', url: pub.url })

    expect(page.statusCode).toBe(401)
    // Placeholder читалка подписью не считает — поле оставалось безымянным.
    expect(page.body).toContain('aria-label="Пароль галереи"')
    expect(page.body).toContain('autocomplete="current-password"')
  })

  it('маленькой галерее поиск не нужен', async () => {
    await store.writeBuffer(convId, 'один.png', PNG_BYTES)
    const pub = (await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/publish` })).json() as { url: string }
    const page = await app.inject({ method: 'GET', url: pub.url, headers: { host: 'studio.test' } })

    expect(page.body).not.toContain('role="search"')
    expect(page.body).toContain('1 файл')
  })
})

describe('студия картинок: корзина', () => {
  it('удаление уводит в корзину, restore возвращает со свободным именем', async () => {
    await store.writeBuffer(convId, 'кот.png', PNG_BYTES)
    await app.inject({ method: 'DELETE', url: `/api/image-studio/${convId}/file?path=${encodeURIComponent('кот.png')}` })
    expect(await store.list(convId)).toEqual([])

    const trash = (await app.inject({ method: 'GET', url: `/api/image-studio/${convId}/trash` })).json() as { items: Array<{ name: string }> }
    expect(trash.items.map((item) => item.name)).toEqual(['кот.png'])

    // Пока файл в корзине, место занято уже новым «кот.png» — restore не затирает.
    await store.writeBuffer(convId, 'кот.png', PNG_BYTES)
    const restored = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/restore`, payload: { name: 'кот.png' } })
    expect(restored.json().name).toBe('кот-2.png')
    expect((await app.inject({ method: 'GET', url: `/api/image-studio/${convId}/trash` })).json().items).toEqual([])
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/restore`, payload: { name: 'кот.png' } })).statusCode).toBe(404)
  })

  it('очистка корзины: по имени и целиком, после неё restore уже невозможен', async () => {
    await store.writeBuffer(convId, 'пёс.png', PNG_BYTES)
    await store.writeBuffer(convId, 'кит.png', PNG_BYTES)
    await app.inject({ method: 'DELETE', url: `/api/image-studio/${convId}/file?path=${encodeURIComponent('пёс.png')}` })
    await app.inject({ method: 'DELETE', url: `/api/image-studio/${convId}/file?path=${encodeURIComponent('кит.png')}` })

    const one = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/trash/purge`, payload: { name: 'пёс.png' } })
    expect(one.json()).toMatchObject({ removed: 1 })
    expect((one.json() as { items: Array<{ name: string }> }).items.map((item) => item.name)).toEqual(['кит.png'])
    // Вычищенное не восстановить — на это и рассчитано.
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/restore`, payload: { name: 'пёс.png' } })).statusCode).toBe(404)

    const all = await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/trash/purge`, payload: {} })
    expect(all.json()).toEqual({ removed: 1, items: [] })
    // Пустую корзину чистить не ошибка: кнопка не обязана знать про гонки.
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/trash/purge`, payload: {} })).json()).toEqual({ removed: 0, items: [] })
    // А вот несуществующее имя — 404: значит, промахнулись мимо записи.
    expect((await app.inject({ method: 'POST', url: `/api/image-studio/${convId}/trash/purge`, payload: { name: 'кот.png' } })).statusCode).toBe(404)
  })
})
