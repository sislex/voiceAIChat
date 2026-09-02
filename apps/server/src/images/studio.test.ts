import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageStudioStore, ImageStudioError } from './studio.js'

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
    await store.writeBuffer(CONV, 'кот.png', Buffer.from('a'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    await store.writeBuffer(CONV, 'пёс.png', Buffer.from('bb'))
    expect((await store.list(CONV)).map((file) => file.path)).toEqual(['пёс.png', 'кот.png'])

    await store.rename(CONV, 'кот.png', 'котик.png')
    expect(await store.readBuffer(CONV, 'котик.png')).not.toBeNull()
    await store.delete(CONV, 'пёс.png')
    expect((await store.list(CONV)).map((file) => file.path)).toEqual(['котик.png'])
  })

  it('отклоняет не-картинки, каталоги и обход путей', async () => {
    for (const bad of ['script.js', '../up.png', 'a/b.png', '.hidden.png', '']) {
      await expect(store.writeBuffer(CONV, bad, Buffer.from('x'))).rejects.toBeInstanceOf(ImageStudioError)
    }
  })

  it('freeName подбирает свободное имя с суффиксом', async () => {
    await store.writeBuffer(CONV, 'арт.png', Buffer.from('x'))
    await store.writeBuffer(CONV, 'арт-2.png', Buffer.from('x'))
    expect(await store.freeName(CONV, 'арт.png')).toBe('арт-3.png')
    expect(await store.freeName(CONV, 'новый.png')).toBe('новый.png')
  })

  it('держит квоту галереи и лимит файла', async () => {
    const big = Buffer.alloc(13 * 1024 * 1024)
    await expect(store.writeBuffer(CONV, 'huge.png', big)).rejects.toMatchObject({ code: 'too_big' })
  })
})
