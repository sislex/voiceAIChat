import { describe, it, expect } from 'vitest'
import {
  appendImageHint,
  imageBlock,
  imageMime,
  imageName,
  isImagePath,
  parseImages,
  IMAGE_HINT
} from './images'

describe('parseImages — блок ```image', () => {
  it('вырезает блок и возвращает путь', () => {
    const text = 'Готово, вот схема.\n\n```image\n{"path":"/tmp/out.png"}\n```'
    const r = parseImages(text)
    expect(r.body).toBe('Готово, вот схема.')
    expect(r.images).toEqual([{ path: '/tmp/out.png' }])
  })

  it('забирает agentId и caption', () => {
    const text = '```image\n{"path":"/tmp/a.png","agentId":"m1","caption":"Схема"}\n```'
    expect(parseImages(text).images).toEqual([
      { path: '/tmp/a.png', agentId: 'm1', caption: 'Схема' }
    ])
  })

  it('несколько блоков — несколько картинок в порядке появления', () => {
    const text = 'Раз\n```image\n{"path":"/a.png"}\n```\nДва\n```image\n{"path":"/b.png"}\n```'
    const r = parseImages(text)
    expect(r.images.map((i) => i.path)).toEqual(['/a.png', '/b.png'])
    expect(r.body).toContain('Раз')
    expect(r.body).toContain('Два')
    expect(r.body).not.toContain('/a.png')
  })

  it('битый JSON оставляет блок в тексте', () => {
    const text = 'Текст\n```image\n{path: /tmp/a.png}\n```'
    const r = parseImages(text)
    expect(r.images).toEqual([])
    expect(r.body).toBe(text)
  })

  it('блок без path игнорируется', () => {
    expect(parseImages('```image\n{"caption":"без пути"}\n```').images).toEqual([])
  })

  it('текст без картинок возвращается как есть', () => {
    const r = parseImages('Обычный ответ')
    expect(r).toEqual({ body: 'Обычный ответ', images: [] })
  })
})

describe('parseImages — markdown-картинка с локальным путём', () => {
  it('вырезает ![alt](/abs/path.png) и берёт alt как подпись', () => {
    const r = parseImages('Смотри: ![Схема](/tmp/out.png) — готово')
    expect(r.images).toEqual([{ path: '/tmp/out.png', caption: 'Схема' }])
    expect(r.body).toBe('Смотри:  — готово')
  })

  it('внешние URL и data: остаются markdown-ом', () => {
    const text = '![a](https://x/y.png) ![b](data:image/png;base64,AAA)'
    const r = parseImages(text)
    expect(r.images).toEqual([])
    expect(r.body).toBe(text)
  })

  it('локальный путь без расширения картинки не трогаем', () => {
    const text = '![readme](/tmp/readme.md)'
    expect(parseImages(text).images).toEqual([])
  })

  it('относительный путь тоже считается локальным', () => {
    expect(parseImages('![](out/chart.webp)').images).toEqual([{ path: 'out/chart.webp' }])
  })

  it('один путь и блоком, и markdown-ом — одна картинка', () => {
    const text = '![Схема](/tmp/a.png)\n```image\n{"path":"/tmp/a.png"}\n```'
    const r = parseImages(text)
    expect(r.images).toHaveLength(1)
    expect(r.body).toBe('')
  })
})

describe('вспомогательные функции картинок', () => {
  it('isImagePath различает расширения без учёта регистра', () => {
    expect(isImagePath('/tmp/a.PNG')).toBe(true)
    expect(isImagePath('/tmp/a.svg')).toBe(true)
    expect(isImagePath('/tmp/a.txt')).toBe(false)
    expect(isImagePath('/tmp/noext')).toBe(false)
  })

  it('imageMime по расширению', () => {
    expect(imageMime('/tmp/a.jpg')).toBe('image/jpeg')
    expect(imageMime('/tmp/a.svg')).toBe('image/svg+xml')
    expect(imageMime('/tmp/a.bin')).toBe('application/octet-stream')
  })

  it('imageName берёт последний сегмент пути (в т.ч. windows)', () => {
    expect(imageName('/tmp/dir/out.png')).toBe('out.png')
    expect(imageName('C:\\tmp\\out.png')).toBe('out.png')
  })

  it('imageBlock и parseImages — обратимы', () => {
    const image = { path: '/tmp/a.png', caption: 'Подпись' }
    expect(parseImages(imageBlock(image)).images).toEqual([image])
  })

  it('appendImageHint дописывает подсказку, но не к пустому промпту', () => {
    expect(appendImageHint('вопрос')).toContain(IMAGE_HINT)
    expect(appendImageHint('   ')).toBe('   ')
  })
})
