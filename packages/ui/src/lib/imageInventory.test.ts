import { describe, it, expect, vi } from 'vitest'
import { groupDuplicates, inventoryMarkdown, mapWithLimit } from './imageInventory'
import type { ImageStudioFile } from '@shared/imageStudio'

const file = (path: string, patch: Partial<ImageStudioFile> = {}): ImageStudioFile => ({ path, size: 1024, updatedAt: 1, ...patch })

describe('inventoryMarkdown', () => {
  it('таблица с заголовком, размерами и итогом', () => {
    const text = inventoryMarkdown([file('кот.png', { size: 2048, prompt: 'кот' }), file('пёс.png')], { dimensions: { 'кот.png': '512×512' } })
    expect(text.split('\n')[0]).toBe('| Файл | Размер | Пиксели | Промпт | Заметка |')
    expect(text).toContain('| кот.png | 2 КБ | 512×512 | кот |  |')
    expect(text).toContain('Всего файлов: 2, занято 3 КБ.')
  })

  it('вертикальная черта и перевод строки в промпте не ломают таблицу', () => {
    const text = inventoryMarkdown([file('к.png', { prompt: 'кот | пёс\nи кит' })])
    const row = text.split('\n').find((line) => line.startsWith('| к.png'))!
    expect(row.split(' | ')).toHaveLength(5)
    expect(row).toContain('кот \\| пёс и кит')
  })

  it('заметки попадают в свою колонку', () => {
    const text = inventoryMarkdown([file('к.png')], { notes: { 'к.png': 'для обложки' } })
    expect(text).toContain('для обложки')
  })
})

describe('groupDuplicates', () => {
  it('группирует по содержимому и оставляет самый старый файл', () => {
    const files = [
      file('копия.png', { updatedAt: 30 }),
      file('оригинал.png', { updatedAt: 10 }),
      file('ещё-копия.png', { updatedAt: 20 }),
      file('другой.png', { updatedAt: 5 })
    ]
    const keys: Record<string, string> = { 'копия.png': 'A', 'оригинал.png': 'A', 'ещё-копия.png': 'A', 'другой.png': 'B' }
    expect(groupDuplicates(files, (item) => keys[item.path])).toEqual([
      { keep: 'оригинал.png', copies: ['ещё-копия.png', 'копия.png'] }
    ])
  })

  it('файлы без ключа содержимого игнорируются, одиночки не группируются', () => {
    const files = [file('а.png'), file('б.png')]
    expect(groupDuplicates(files, () => undefined)).toEqual([])
    expect(groupDuplicates(files, (item) => item.path)).toEqual([])
  })

  it('одинаковое время сортируется по имени — порядок предсказуем', () => {
    const files = [file('я.png', { updatedAt: 7 }), file('а.png', { updatedAt: 7 })]
    expect(groupDuplicates(files, () => 'A')).toEqual([{ keep: 'а.png', copies: ['я.png'] }])
  })
})

describe('mapWithLimit', () => {
  it('сохраняет порядок результатов и не превышает лимит параллельных задач', async () => {
    let running = 0
    let peak = 0
    const result = await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running -= 1
      return item * 2
    })
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14])
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('пустой список не запускает ни одной задачи', async () => {
    const task = vi.fn(async (item: number) => item)
    expect(await mapWithLimit([], 4, task)).toEqual([])
    expect(task).not.toHaveBeenCalled()
  })

  it('лимит меньше единицы всё равно выполняет работу — по одной задаче', async () => {
    expect(await mapWithLimit([1, 2], 0, async (item) => item + 1)).toEqual([2, 3])
  })
})
