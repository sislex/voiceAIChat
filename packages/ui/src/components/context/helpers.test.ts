import { describe, it, expect } from 'vitest'
import type { ContextSnapshotItem, ConversationContextSnapshot } from '@shared/types'
import { detailIdFromHash, filterSnapshotByGroup, highlightParts, matchesQuery, reasonFor, sizeLabel, slugForFilename, userStatus } from './helpers'

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

  describe('срез снимка по группе', () => {
    const snapshot = (): ConversationContextSnapshot => ({
      schemaVersion: 1,
      conversationId: 'c1',
      generatedAt: '2026-09-05T10:00:00.000Z',
      freshnessWarning: '',
      summary: {
        provider: 'claude',
        model: 'sonnet',
        permissionMode: { value: 'acceptEdits', displayName: 'acceptEdits', explanation: '' },
        kbMode: { value: 'auto', displayName: 'Авто', explanation: '' }
      },
      groups: [
        { id: 'settings', order: 1, title: 'Настройки', description: '', items: [item({ id: 'personalization' }), item({ id: 'project-binding' })] },
        { id: 'instructions', order: 2, title: 'Инструкции', description: '', items: [item({ id: 'instruction-1' })] }
      ],
      viewerRole: 'developer',
      owner: 'me',
      foreign: false,
      lastTurn: null,
      changes: [
        { at: 1, actor: 'me', itemId: 'personalization', enabled: false },
        { at: 2, actor: 'me', itemId: 'instruction-1', enabled: true }
      ],
      disallowedTools: ['fs.write'],
      cliMcpServers: [],
      warnings: [],
      promptPreview: {
        blocks: [
          { itemIds: ['personalization'], title: 'Персонализация', text: 'персона', chars: 7, approxTokens: 2 },
          { itemIds: ['instruction-1'], title: 'Инструкция 1', text: 'подсказка', chars: 9, approxTokens: 3 }
        ],
        text: 'персона\n\nподсказка',
        chars: 17,
        approxTokens: 5,
        omitted: [],
        costUsd: 0.001,
        turnTotal: { chars: 100, approxTokens: 30, historyChars: 80, historyApproxTokens: 25, resumed: false },
        costByModel: [{ model: 'sonnet', costUsd: 0.001 }]
      },
      turnSizes: [{ at: '2026-09-05T09:00:00.000Z', model: 'sonnet', chars: 100, approxTokens: 30, resumed: false, costUsd: null }]
    })

    it('оставляет одну группу, её changes и её блоки промпта', () => {
      const cut = filterSnapshotByGroup(snapshot(), 'instructions')
      expect(cut.groups).toHaveLength(1)
      expect(cut.groups[0].id).toBe('instructions')
      expect(cut.changes.map((event) => event.itemId)).toEqual(['instruction-1'])
      expect(cut.promptPreview.blocks.map((block) => block.title)).toEqual(['Инструкция 1'])
      expect(cut.promptPreview.text).toBe('подсказка')
      expect(cut.promptPreview.chars).toBe('подсказка'.length)
      expect(cut.promptPreview.approxTokens).toBe(3)
    })

    it('обнуляет то, что нельзя честно поделить между группами', () => {
      const cut = filterSnapshotByGroup(snapshot(), 'instructions')
      // Стоимость постоянной части — не про одну группу, ход общий.
      expect(cut.promptPreview.costUsd).toBeNull()
      expect(cut.promptPreview.costByModel).toEqual([])
      // История разговора — тоже общее, деление её между группами обмануло бы.
      expect(cut.promptPreview.turnTotal.historyApproxTokens).toBe(0)
      // Размеры прошлых ходов — про весь чат, не про группу.
      expect(cut.turnSizes).toEqual([])
    })

    it('возвращает исходный снимок, если группы нет (защита от гонки после удаления)', () => {
      const original = snapshot()
      expect(filterSnapshotByGroup(original, 'нет-такой')).toBe(original)
    })

    it('slug имени файла — латиница-дефис; иначе браузер портит юникод', () => {
      expect(slugForFilename('Instructions')).toBe('instructions')
      expect(slugForFilename('Chat Instructions!')).toBe('chat-instructions')
      // Полностью нелатинское имя даёт запасной slug, а не пустую строку.
      expect(slugForFilename('Инструкции')).toBe('group')
    })
  })
})
