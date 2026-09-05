import { describe, expect, it } from 'vitest'
import { countRu, pluralRu } from './plural'

describe('pluralRu', () => {
  it('склоняет по последней цифре', () => {
    expect(pluralRu(1, 'файл', 'файла', 'файлов')).toBe('файл')
    expect(pluralRu(2, 'файл', 'файла', 'файлов')).toBe('файла')
    expect(pluralRu(5, 'файл', 'файла', 'файлов')).toBe('файлов')
    expect(pluralRu(21, 'файл', 'файла', 'файлов')).toBe('файл')
    expect(pluralRu(88, 'файл', 'файла', 'файлов')).toBe('файлов')
  })

  it('одиннадцать–четырнадцать — исключение', () => {
    // Именно на них ломаются наивные реализации «по последней цифре».
    for (const n of [11, 12, 13, 14, 111, 112]) {
      expect(pluralRu(n, 'файл', 'файла', 'файлов')).toBe('файлов')
    }
  })

  it('ноль и отрицательные не ломают форму', () => {
    expect(pluralRu(0, 'файл', 'файла', 'файлов')).toBe('файлов')
    expect(pluralRu(-3, 'файл', 'файла', 'файлов')).toBe('файла')
  })

  it('countRu добавляет само число', () => {
    expect(countRu(1, 'файл', 'файла', 'файлов')).toBe('1 файл')
    expect(countRu(88, 'файл', 'файла', 'файлов')).toBe('88 файлов')
  })
})
