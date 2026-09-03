import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageStudioStore, ImageStudioError } from './studio.js'


/** Валидные PNG-байты: sniffing содержимого пропускает только настоящие картинки. */
const png = (suffix = '') => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(suffix)])

let dir: string
let store: ImageStudioStore
const CONV = 'conv-1'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'img-studio-'))
  store = new ImageStudioStore(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('ImageStudioStore', () => {
  it('пишет, листает свежими сверху, переименовывает и удаляет', async () => {
    await store.writeBuffer(CONV, 'кот.png', png('a'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.writeBuffer(CONV, 'пёс.png', png('bb'))
    expect((await store.list(CONV)).map((file) => file.path)).toEqual(['пёс.png', 'кот.png'])

    await store.rename(CONV, 'кот.png', 'котик.png')
    expect(await store.readBuffer(CONV, 'котик.png')).not.toBeNull()
    await store.delete(CONV, 'пёс.png')
    expect((await store.list(CONV)).map((file) => file.path)).toEqual(['котик.png'])
  })

  it('отклоняет не-картинки, каталоги и обход путей', async () => {
    for (const bad of ['script.js', '../up.png', 'a/b.png', '.hidden.png', '']) {
      await expect(store.writeBuffer(CONV, bad, png('x'))).rejects.toBeInstanceOf(ImageStudioError)
    }
  })

  it('freeName подбирает свободное имя с суффиксом', async () => {
    await store.writeBuffer(CONV, 'арт.png', png('x'))
    await store.writeBuffer(CONV, 'арт-2.png', png('x'))
    expect(await store.freeName(CONV, 'арт.png')).toBe('арт-3.png')
    expect(await store.freeName(CONV, 'новый.png')).toBe('новый.png')
  })

  it('держит квоту галереи и лимит файла', async () => {
    const big = Buffer.concat([png(), Buffer.alloc(13 * 1024 * 1024)])
    await expect(store.writeBuffer(CONV, 'huge.png', big)).rejects.toMatchObject({ code: 'too_big' })
  })
})

describe('ImageStudioStore: sniffing содержимого', () => {
  it('мусор под видом картинки отклоняется, настоящие сигнатуры проходят', async () => {
    await expect(store.writeBuffer(CONV, 'фейк.png', Buffer.from('MZ исполняемый'))).rejects.toMatchObject({ code: 'bad_media' })
    await expect(store.writeBuffer(CONV, 'фейк.jpg', Buffer.from('обычный текст'))).rejects.toMatchObject({ code: 'bad_media' })

    await store.writeBuffer(CONV, 'ок.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))
    await store.writeBuffer(CONV, 'ок.gif', Buffer.from('GIF89a...'))
    await store.writeBuffer(CONV, 'ок.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))
    await store.writeBuffer(CONV, 'ок.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    expect((await store.list(CONV)).length).toBe(4)
  })
})
