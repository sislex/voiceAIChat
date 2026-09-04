import { describe, expect, it } from 'vitest'
import type { ImageStudioFile } from '@shared/imageStudio'
import { approxColorCount, extensionMismatch, hasAlphaPixels, notesMarkdown, sniffImageType, versionTree } from './imageFacts'

describe('sniffImageType', () => {
  it('узнаёт png, jpg, gif и webp по сигнатуре', () => {
    expect(sniffImageType([0x89, 0x50, 0x4e, 0x47, 0x0d])).toBe('png')
    expect(sniffImageType([0xff, 0xd8, 0xff, 0xe0])).toBe('jpg')
    expect(sniffImageType([0x47, 0x49, 0x46, 0x38, 0x39])).toBe('gif')
    expect(sniffImageType([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])).toBe('webp')
  })

  it('svg узнаёт как текст, незнакомое — null', () => {
    const svg = Array.from('<svg xmlns="http://www.w3.org/2000/svg">').map((char) => char.charCodeAt(0))
    expect(sniffImageType(svg)).toBe('svg')
    expect(sniffImageType([1, 2, 3, 4])).toBeNull()
    expect(sniffImageType([])).toBeNull()
  })
})

describe('extensionMismatch', () => {
  it('молчит на совпадении и на неизвестном типе, jpeg равен jpg', () => {
    expect(extensionMismatch('кот.png', 'png')).toBeNull()
    expect(extensionMismatch('кот.jpeg', 'jpg')).toBeNull()
    expect(extensionMismatch('кот.png', null)).toBeNull()
  })

  it('называет настоящий тип, когда расширение врёт', () => {
    expect(extensionMismatch('кот.png', 'jpg')).toBe('Файл на самом деле JPG, а расширение «.png»')
  })
})

describe('hasAlphaPixels', () => {
  it('находит полупрозрачность и не путает её с плотным альфа-каналом', () => {
    expect(hasAlphaPixels([1, 2, 3, 255, 4, 5, 6, 255])).toBe(false)
    expect(hasAlphaPixels([1, 2, 3, 255, 4, 5, 6, 0])).toBe(true)
    // 250 — порог: JPEG-каналы после перекодировки бывают 254, это не прозрачность.
    expect(hasAlphaPixels([1, 2, 3, 254])).toBe(false)
  })
})

describe('approxColorCount', () => {
  it('огрубляет цвета до 4 бит и пропускает прозрачные пиксели', () => {
    // Два почти одинаковых красных попадают в одну корзину.
    expect(approxColorCount([250, 0, 0, 255, 255, 0, 0, 255])).toBe(1)
    expect(approxColorCount([255, 0, 0, 255, 0, 255, 0, 255])).toBe(2)
    expect(approxColorCount([255, 0, 0, 0])).toBe(0)
  })
})

describe('versionTree', () => {
  const file = (path: string, source?: string, updatedAt = 1): ImageStudioFile => ({ path, size: 1, updatedAt, ...(source ? { source } : {}) })

  it('строит дерево от корня с уровнями вложенности', () => {
    const files = [file('кот.png'), file('кот-2.png', 'кот.png', 2), file('кот-3.png', 'кот.png', 3), file('кот-2-crop.png', 'кот-2.png', 4)]
    expect(versionTree(files, 'кот-2-crop.png')).toEqual([
      { path: 'кот.png', depth: 0 },
      { path: 'кот-2.png', depth: 1 },
      { path: 'кот-2-crop.png', depth: 2 },
      { path: 'кот-3.png', depth: 1 }
    ])
  })

  it('одиночка — дерево из одного узла, отсутствующий файл — пустое', () => {
    expect(versionTree([file('один.png')], 'один.png')).toEqual([{ path: 'один.png', depth: 0 }])
    expect(versionTree([file('один.png')], 'нет.png')).toEqual([])
  })

  it('цикл в source не вешает обход', () => {
    const files = [file('а.png', 'б.png'), file('б.png', 'а.png')]
    expect(versionTree(files, 'а.png').length).toBeLessThanOrEqual(2)
  })
})

describe('notesMarkdown', () => {
  it('собирает заметки по алфавиту и молчит, когда их нет', () => {
    expect(notesMarkdown({ 'б.png': 'вторая', 'а.png': ' первая ' })).toBe('# Заметки галереи\n\n- **а.png** — первая\n- **б.png** — вторая\n')
    expect(notesMarkdown({})).toBe('')
    expect(notesMarkdown({ 'а.png': '   ' })).toBe('')
  })
})
