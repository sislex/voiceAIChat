import { describe, expect, it } from 'vitest'
import {
  averageColor, BIG_FILE_BYTES, colorDistance, colorHue, DOWNSCALE_SIDE,
  promptTemplateFill, promptTemplateVars, rangeBetween, safeUploadName, shouldDownscale
} from './imageIntake'

describe('safeUploadName', () => {
  it('убирает путь, пробелы и запрещённые знаки, оставляя русские буквы', () => {
    expect(safeUploadName('/Users/me/Кот в шляпе.PNG')).toBe('Кот-в-шляпе.png')
    expect(safeUploadName('снимок экрана 2026-09-04 в 12:31:05.png')).toBe('снимок-экрана-2026-09-04-в-123105.png')
    expect(safeUploadName('a"b*c?.jpg')).toBe('abc.jpg')
  })

  it('без расширения даёт .png, пустое имя — «изображение»', () => {
    expect(safeUploadName('кот')).toBe('кот.png')
    expect(safeUploadName('   ')).toBe('изображение.png')
    expect(safeUploadName('***.png')).toBe('изображение.png')
  })

  it('длинное имя урезается, двойные дефисы схлопываются', () => {
    expect(safeUploadName(`${'а'.repeat(90)}.png`)).toBe(`${'а'.repeat(60)}.png`)
    expect(safeUploadName('кот   —   шляпа.png')).toBe('кот-—-шляпа.png')
  })
})

describe('shouldDownscale', () => {
  it('срабатывает от предела по длинной стороне', () => {
    expect(shouldDownscale(4001, 100)).toBe(true)
    expect(shouldDownscale(100, DOWNSCALE_SIDE + 1)).toBe(true)
    expect(shouldDownscale(DOWNSCALE_SIDE, DOWNSCALE_SIDE)).toBe(false)
  })

  it('порог большого файла — десять мегабайт', () => {
    expect(BIG_FILE_BYTES).toBe(10485760)
  })
})

describe('promptTemplateFill', () => {
  it('подставляет переменные и оставляет незаполненные видимыми', () => {
    expect(promptTemplateFill('{объект} в стиле {стиль}', { объект: 'рыжий кот', стиль: 'акварель' })).toBe('рыжий кот в стиле акварель')
    expect(promptTemplateFill('{объект} на {фоне}', { объект: 'кот' })).toBe('кот на {фоне}')
    expect(promptTemplateFill('без переменных', {})).toBe('без переменных')
    // Пробелы внутри скобок не мешают, пустое значение считается незаполненным.
    expect(promptTemplateFill('{ объект } готов', { объект: 'кот' })).toBe('кот готов')
    expect(promptTemplateFill('{объект} готов', { объект: '  ' })).toBe('{объект} готов')
  })
})

describe('promptTemplateVars', () => {
  it('перечисляет переменные по порядку без повторов', () => {
    expect(promptTemplateVars('{объект} и ещё {объект} на {фоне}')).toEqual(['объект', 'фоне'])
    expect(promptTemplateVars('нет переменных')).toEqual([])
  })
})

describe('averageColor и colorDistance', () => {
  it('средний цвет считается без прозрачных пикселей', () => {
    expect(averageColor([255, 0, 0, 255, 0, 0, 255, 255])).toEqual({ r: 128, g: 0, b: 128 })
    expect(averageColor([255, 0, 0, 0])).toBeNull()
    expect(averageColor([])).toBeNull()
  })

  it('расстояние: одинаковые — ноль, чёрный и белый — максимум', () => {
    expect(colorDistance({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 })).toBe(0)
    expect(colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBe(442)
  })
})

describe('colorHue', () => {
  it('красный, зелёный и синий дают свои углы, серый — ноль', () => {
    expect(colorHue({ r: 255, g: 0, b: 0 })).toBe(0)
    expect(colorHue({ r: 0, g: 255, b: 0 })).toBe(120)
    expect(colorHue({ r: 0, g: 0, b: 255 })).toBe(240)
    expect(colorHue({ r: 128, g: 128, b: 128 })).toBe(0)
  })
})

describe('rangeBetween', () => {
  it('диапазон включает края и работает в обе стороны', () => {
    expect(rangeBetween(2, 5)).toEqual([2, 3, 4, 5])
    expect(rangeBetween(5, 2)).toEqual([2, 3, 4, 5])
    expect(rangeBetween(3, 3)).toEqual([3])
  })
})
