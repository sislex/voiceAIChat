import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseImages } from '@voicechat/shared'
import { machineImagePath, relocateImagesToMachine } from './imageRelocate.js'

let home: string
let pic: string

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'vc-reloc-')))
  mkdirSync(join(home, '.codex', 'generated_images', 'sess'), { recursive: true })
  pic = join(home, '.codex', 'generated_images', 'sess', 'call_x.png')
  writeFileSync(pic, 'PNGDATA')
})

afterEach(() => rmSync(home, { recursive: true, force: true }))

function deps(overrides: Partial<Parameters<typeof relocateImagesToMachine>[2]> = {}) {
  return {
    readFile: vi.fn(async (path: string) =>
      path === pic ? { name: 'call_x.png', dataBase64: readFileSync(pic).toString('base64') } : null
    ),
    fsList: vi.fn().mockResolvedValue({ root: '/home/user' }),
    fsMkdir: vi.fn().mockResolvedValue(undefined),
    fsWrite: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('machineImagePath', () => {
  it('кладёт файл в .generated_images внутри корня машины', () => {
    expect(machineImagePath('/home/user', 'a.png')).toBe('/home/user/.generated_images/a.png')
  })

  it('лишний слэш в конце корня не удваивается', () => {
    expect(machineImagePath('/home/user/', 'a.png')).toBe('/home/user/.generated_images/a.png')
  })

  it('windows-корень — обратные слэши', () => {
    expect(machineImagePath('C:\\Users\\u', 'a.png')).toBe('C:\\Users\\u\\.generated_images\\a.png')
  })
})

describe('relocateImagesToMachine', () => {
  it('пишет файл на машину и переписывает блок на путь машины', async () => {
    const d = deps()
    const text = `Готово\n\n\`\`\`image\n{"path":"${pic}"}\n\`\`\``
    const out = await relocateImagesToMachine(text, 'm1', d)

    expect(d.fsMkdir).toHaveBeenCalledWith('m1', '/home/user/.generated_images')
    expect(d.fsWrite).toHaveBeenCalledWith(
      'm1',
      '/home/user/.generated_images/call_x.png',
      Buffer.from('PNGDATA').toString('base64')
    )
    expect(parseImages(out).images).toEqual([
      { path: '/home/user/.generated_images/call_x.png', agentId: 'm1' }
    ])
  })

  it('markdown-картинка тоже переезжает и становится блоком', async () => {
    const d = deps()
    const out = await relocateImagesToMachine(`Вот: ![Схема](${pic})`, 'm1', d)
    expect(d.fsWrite).toHaveBeenCalled()
    expect(parseImages(out).images).toEqual([
      { path: '/home/user/.generated_images/call_x.png', agentId: 'm1', caption: 'Схема' }
    ])
  })

  it('машина офлайн (fsList падает) — текст не меняется, запись не идёт', async () => {
    const d = deps({ fsList: vi.fn().mockRejectedValue(new Error('офлайн')) })
    const text = `\`\`\`image\n{"path":"${pic}"}\n\`\`\``
    expect(await relocateImagesToMachine(text, 'm1', d)).toBe(text)
    expect(d.fsWrite).not.toHaveBeenCalled()
  })

  it('запись запрещена — картинка остаётся серверной', async () => {
    const d = deps({ fsWrite: vi.fn().mockRejectedValue(new Error('нельзя писать')) })
    const text = `\`\`\`image\n{"path":"${pic}"}\n\`\`\``
    const out = await relocateImagesToMachine(text, 'm1', d)
    expect(parseImages(out).images).toEqual([{ path: pic }])
  })

  it('файл вне своей области не трогаем', async () => {
    const d = deps({ readFile: vi.fn().mockResolvedValue(null) })
    const text = `\`\`\`image\n{"path":"${pic}"}\n\`\`\``
    expect(await relocateImagesToMachine(text, 'm1', d)).toBe(text)
    expect(d.fsList).not.toHaveBeenCalled()
  })

  it('картинка, уже привязанная к машине, повторно не переносится', async () => {
    const d = deps()
    const text = '```image\n{"path":"/home/user/.generated_images/a.png","agentId":"m1"}\n```'
    expect(await relocateImagesToMachine(text, 'm1', d)).toBe(text)
    expect(d.fsWrite).not.toHaveBeenCalled()
  })

  it('текст без картинок возвращается как есть, машину не дёргаем', async () => {
    const d = deps()
    expect(await relocateImagesToMachine('обычный ответ', 'm1', d)).toBe('обычный ответ')
    expect(d.fsList).not.toHaveBeenCalled()
  })
})
