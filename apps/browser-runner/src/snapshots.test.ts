// Круг 12: снимки состояния и их сравнение. «Не сломалась ли вёрстка» человек
// проверяет глазами — смотрит до и после; у модели сравнивать было не с чем, а
// описать словами разницу в пять пикселей невозможно.

import { describe, expect, it } from 'vitest'
import { diffText, SessionSnapshots, snapshotVerdict } from './snapshots'

const shot = (name: string, over: Partial<{ at: number; url: string; title: string; dataUrl: string; text: string }> = {}) => ({
  name, at: over.at ?? Date.now(), url: over.url ?? 'https://a.b/', title: over.title ?? 'Страница',
  dataUrl: over.dataUrl ?? 'data:image/png;base64,QQ==', text: over.text ?? 'Итого 100'
})

describe('снимки состояния', () => {
  it('снимок с тем же именем заменяется, а не копится', () => {
    const snapshots = new SessionSnapshots()
    snapshots.save(shot('до'))
    snapshots.save(shot('до', { text: 'Итого 200' }))
    expect(snapshots.list()).toHaveLength(1)
    expect(snapshots.get('до')?.text).toBe('Итого 200')
  })

  it('старый снимок вытесняется: память сессии не должна расти молча', () => {
    const snapshots = new SessionSnapshots()
    for (let index = 0; index < 12; index++) snapshots.save(shot(`s${index}`, { at: index }))
    expect(snapshots.list()).toHaveLength(10)
    expect(snapshots.get('s0')).toBeNull()
    expect(snapshots.get('s11')).toBeTruthy()
  })

  it('безымянный снимок отвергается', () => {
    expect(() => new SessionSnapshots().save(shot('  '))).toThrow('имя')
  })

  it('список отдаёт размер и длину текста, а не сами данные', () => {
    const snapshots = new SessionSnapshots()
    snapshots.save(shot('до', { dataUrl: 'data:image/png;base64,' + 'A'.repeat(400) }))
    const info = snapshots.list()[0]
    expect(info.bytes).toBeGreaterThan(200)
    expect(info).not.toHaveProperty('dataUrl')
  })

  it('удаление без имени очищает все снимки', () => {
    const snapshots = new SessionSnapshots()
    snapshots.save(shot('а'))
    snapshots.save(shot('б'))
    snapshots.remove()
    expect(snapshots.list()).toHaveLength(0)
  })
})

describe('текстовая разница', () => {
  it('говорит, что появилось и что исчезло', () => {
    const diff = diffText('Итого 100\nКорзина пуста', 'Итого 200\nКорзина пуста')
    expect(diff.added).toEqual(['Итого 200'])
    expect(diff.removed).toEqual(['Итого 100'])
  })

  it('считает повторы, а не множество строк', () => {
    const diff = diffText('Строка', 'Строка\nСтрока')
    expect(diff.added).toEqual(['Строка'])
    expect(diff.addedTotal).toBe(1)
  })

  it('пустые строки и отступы не считаются изменением', () => {
    expect(diffText('  Итого\n\n', 'Итого')).toMatchObject({ addedTotal: 0, removedTotal: 0 })
  })

  it('длинный список обрезается, но общее число остаётся', () => {
    const after = Array.from({ length: 50 }, (_, index) => `строка ${index}`).join('\n')
    const diff = diffText('', after, 5)
    expect(diff.added).toHaveLength(5)
    expect(diff.addedTotal).toBe(50)
  })
})

// Круг 16: вердикт словами. Живая проверка показала, что «различий 0» при
// изменившемся тексте человек читает как «ничего не изменилось», хотя почти
// всегда это изменение ниже сгиба.
describe('вердикт сравнения', () => {
  it('совпало — когда не изменились ни пиксели, ни текст', () => {
    expect(snapshotVerdict({ ratio: 0, sizeChanged: false, textChanged: false })).toBe('identical')
  })

  it('видимое изменение называется видимым', () => {
    expect(snapshotVerdict({ ratio: 0.12, sizeChanged: false, textChanged: true })).toBe('visual')
  })

  it('пиксели те же, а текст другой — это dom-only, а не «нет различий»', () => {
    expect(snapshotVerdict({ ratio: 0, sizeChanged: false, textChanged: true })).toBe('dom-only')
  })

  it('изменившийся размер страницы важнее доли пикселей', () => {
    expect(snapshotVerdict({ ratio: 0.9, sizeChanged: true, textChanged: true })).toBe('resized')
  })
})
