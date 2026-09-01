import { describe, it, expect } from 'vitest'
import type { ContextSnapshotItem } from '@shared/types'
import { detailIdFromHash, highlightParts, matchesQuery, reasonFor, sizeLabel, userStatus } from './helpers'

const item = (extra: Partial<ContextSnapshotItem> = {}): ContextSnapshotItem => ({
  id: 'personalization', type: 'Контекст', source: 'Настройки пользователя', scope: 'Следующий ход', priority: '1',
  title: 'Предпочтения ответа', description: 'Как отвечать', explanation: 'Из общих настроек',
  configured: true, available: true, includedInNextTurn: true, toggleable: true, enabled: true, ...extra
})

describe('helpers инспектора контекста', () => {
  it('статус говорит словами пользователя, а не полями снимка', () => {
    expect(userStatus(item())).toBe('Будет использовано')
    expect(userStatus(item({ enabled: false }))).toBe('Выключено вами')
    expect(userStatus(item({ configured: false, includedInNextTurn: false }))).toBe('Не настроено')
    // Навык и динамические источники определяются в момент отправки.
    expect(userStatus(item({ id: 'skill-review' }))).toBe('Определится после отправки')
  })

  it('поиск ищет и по тексту блока промпта, а не только по названию', () => {
    // «отпуск» стоит внутри персонализации, а не в названии источника — это и
    // есть частый вопрос «почему модель про это знает».
    expect(matchesQuery(item(), 'отпуск')).toBe(false)
    expect(matchesQuery(item(), 'отпуск', 'В сентябре у меня отпуск')).toBe(true)
    // Пустой запрос показывает всё.
    expect(matchesQuery(item(), '   ')).toBe(true)
  })

  it('подсветка ограничена, чтобы частая подстрока не рвала предпросмотр на тысячи узлов', () => {
    const parts = highlightParts('а'.repeat(1000), 'а')
    expect(parts.filter((part) => part.hit)).toHaveLength(200)
    // Текст остаётся полным: хвост идёт одним куском.
    expect(parts.map((part) => part.text).join('')).toHaveLength(1000)
  })

  it('подсветка не теряет текст вокруг совпадений', () => {
    expect(highlightParts('гейт красный, гейт зелёный', 'гейт').map((part) => part.text).join(''))
      .toBe('гейт красный, гейт зелёный')
  })

  it('размер показывается только у пунктов с вкладом в промпт', () => {
    expect(sizeLabel(item())).toBeNull()
    expect(sizeLabel(item({ size: { chars: 0, approxTokens: 0 } }))).toBeNull()
    expect(sizeLabel(item({ size: { chars: 400, approxTokens: 100 } }))).toContain('≈100 токенов')
  })

  it('причина объясняет выключение и недоступность разными словами', () => {
    expect(reasonFor(item({ enabled: false }))).toContain('выключили')
    expect(reasonFor(item({ available: false }))).toBeTruthy()
  })

  it('id источника читается из адреса вкладки', () => {
    expect(detailIdFromHash('c1', '#/chat/c1/context/personalization')).toBe('personalization')
    expect(detailIdFromHash('c1', '#/chat/c1/context')).toBeNull()
    // Чужой разговор в адресе — не наш пункт.
    expect(detailIdFromHash('c1', '#/chat/c2/context/personalization')).toBeNull()
    // Хвост запроса и вложенный путь не попадают в id.
    expect(detailIdFromHash('c1', '#/chat/c1/context/personalization?from=log')).toBe('personalization')
  })
})
