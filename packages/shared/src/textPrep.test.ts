import { describe, it, expect } from 'vitest'
import { prepareTtsText } from './textPrep'

describe('prepareTtsText', () => {
  it('заменяет блоки кода на фразу (код не озвучивается)', () => {
    const out = prepareTtsText('До кода\n```js\nconst x = 1\n```\nПосле кода')
    expect(out).not.toContain('const x')
    expect(out).toContain('Далее пример кода')
    expect(out).toContain('До кода')
    expect(out).toContain('После кода')
  })

  it('снимает инлайн-код, эмфазу и заголовки', () => {
    expect(prepareTtsText('# Заголовок')).toBe('Заголовок')
    expect(prepareTtsText('Это **важно** и *курсив*')).toBe('Это важно и курсив')
    expect(prepareTtsText('Вызовите `foo()` сейчас')).toBe('Вызовите foo() сейчас')
  })

  it('ссылки → текст, маркеры списков и цитаты убираются', () => {
    expect(prepareTtsText('[Клик](https://x.y)')).toBe('Клик')
    expect(prepareTtsText('- пункт один\n- пункт два')).toBe('пункт один\nпункт два')
    expect(prepareTtsText('> цитата')).toBe('цитата')
  })

  it('схлопывает лишние пробелы и переводы строк', () => {
    expect(prepareTtsText('а   б\n\n\nв')).toBe('а б\nв')
    expect(prepareTtsText('  \n текст \n  ')).toBe('текст')
  })
})
