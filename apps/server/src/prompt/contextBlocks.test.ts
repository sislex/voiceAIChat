import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '@voicechat/shared'
import type { ChatInstruction, UserPersonalization } from '@voicechat/shared'
import { effectiveChatInstructions } from '@voicechat/shared'
import { ageFromBirth, buildContextBlocks, personalizationLines, personalizationPromptBlock, projectContextBlock } from './contextBlocks.js'

const empty: UserPersonalization = DEFAULT_SETTINGS.personalization

describe('contextBlocks — блоки промпта общие у хода и у снимка', () => {
  it('пустая персонализация не даёт блока: в промпт нечего добавлять', () => {
    expect(personalizationLines(empty, new Date('2026-08-31T00:00:00Z'))).toEqual([])
    expect(personalizationPromptBlock(empty, new Date('2026-08-31T00:00:00Z'))).toBeNull()
  })

  it('возраст считается из даты рождения, а не показывается годом', () => {
    // Панель раньше печатала «Дата рождения 01.09.1990», хотя модель получала
    // возраст. Инспектор обещает «вот что получит ИИ» — расхождение недопустимо.
    const p: UserPersonalization = { ...empty, birthYear: 1990, birthMonth: 9, birthDay: 1 }
    expect(ageFromBirth(p, new Date('2026-08-31T00:00:00Z'))).toBe(35)
    expect(ageFromBirth(p, new Date('2026-09-01T00:00:00Z'))).toBe(36)
    expect(personalizationLines(p, new Date('2026-08-31T00:00:00Z'))).toEqual([
      'Возраст пользователя: 35 лет; адаптируй сложность только когда это уместно.'
    ])
  })

  it('стиль и тон по умолчанию молчат, заданные — попадают в текст', () => {
    const p: UserPersonalization = { ...empty, preferredName: 'Алексей', responseStyle: 'brief', tone: 'business', responseLanguage: 'русский' }
    expect(personalizationLines(p, new Date())).toEqual([
      'Обращение к пользователю: Алексей.',
      'Обычный язык ответа: русский; явная просьба в текущем сообщении имеет приоритет.',
      'Стиль ответа: кратко.',
      'Тон общения: деловой.'
    ])
  })

  it('недоступный проект даёт тот же текст, что и ход модели', () => {
    expect(projectContextBlock(null, null)).toBeNull()
    expect(projectContextBlock(null, 'p-1')).toBe(
      '## Контекст проекта «неизвестный проект»\nID проекта: p-1\nПроект больше недоступен этому пользователю.'
    )
  })

  it('блоки идут в порядке сборки промпта и знают свой размер', () => {
    const instructions: ChatInstruction[] = [
      { id: 'own', title: 'Своя', description: '', enabled: true, text: 'Всегда отвечай по-русски.' }
    ]
    const blocks = buildContextBlocks({
      personalization: { ...empty, preferredName: 'Алексей' },
      instructions: effectiveChatInstructions(instructions),
      project: null,
      projectId: null,
      now: new Date()
    })
    expect(blocks.map((block) => block.itemIds)).toEqual([['personalization'], ['instruction-own']])
    expect(blocks[1]?.text).toBe('Всегда отвечай по-русски.')
    expect(blocks[1]?.chars).toBe('Всегда отвечай по-русски.'.length)
    expect(blocks[1]?.approxTokens).toBe(Math.ceil('Всегда отвечай по-русски.'.length / 4))
  })

  it('склеенная подсказка консоль+проводник принадлежит обоим пунктам', () => {
    // Стандартные «терминал» и «проводник» без правок дают модели один текст.
    // Инспектор привязывал блок по индексу и на склейке не находил ничего —
    // человек проваливался в пункт и не видел, какой текст за ним стоит.
    const instructions = effectiveChatInstructions(DEFAULT_SETTINGS.chatInstructions)
    const blocks = buildContextBlocks({ personalization: empty, instructions, project: null, projectId: null, now: new Date() })
    const merged = blocks.find((block) => block.itemIds.length > 1)
    expect(merged?.itemIds).toEqual(['instruction-console', 'instruction-explorer'])
    // Правка одной из них разрывает склейку: у каждой снова свой текст.
    const edited = instructions.map((item) => item.kind === 'console' ? { ...item, text: 'Свой текст про терминал.' } : item)
    const split = buildContextBlocks({ personalization: empty, instructions: edited, project: null, projectId: null, now: new Date() })
    expect(split.every((block) => block.itemIds.length === 1)).toBe(true)
    expect(split.find((block) => block.itemIds[0] === 'instruction-console')?.text).toBe('Свой текст про терминал.')
  })

  it('выключенная в этом чате инструкция в блоки не попадает', () => {
    const instructions: ChatInstruction[] = [
      { id: 'own', title: 'Своя', description: '', enabled: true, text: 'Текст.' },
      { id: 'off', title: 'Выключенная', description: '', enabled: true, text: 'Не должно попасть.' }
    ]
    const blocks = buildContextBlocks({
      personalization: empty,
      instructions: effectiveChatInstructions(instructions, ['instruction-off']),
      project: null,
      projectId: null,
      now: new Date()
    })
    expect(blocks.map((block) => block.text)).toEqual(['Текст.'])
  })
})
