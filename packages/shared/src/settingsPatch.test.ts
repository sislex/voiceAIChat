// Санитайзер патча настроек: граница между «человек поменял тумблер» и записью
// в БД. Настройки хранятся одной JSON-строкой и мержатся с прежними, поэтому
// принятый мусорный ключ остаётся в записи навсегда.

import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAT_INSTRUCTIONS, sanitizeSettingsPatch } from './types'

describe('sanitizeSettingsPatch', () => {
  it('пропускает известные поля и приводит модель Claude к алиасу', () => {
    expect(sanitizeSettingsPatch({ theme: 'dark', autoSpeak: true, model: 'claude-sonnet-4-5' }))
      .toEqual({ theme: 'dark', autoSpeak: true, model: 'sonnet' })
  })

  it('выбрасывает неизвестные ключи и значения не из набора', () => {
    expect(sanitizeSettingsPatch({ theme: 'нечто', llmProvider: 'gemini', permissionMode: 'root', hack: 1 })).toEqual({})
    expect(sanitizeSettingsPatch({ autoSpeak: 'да', generatedFilesTtlDays: 1.5 })).toEqual({})
  })

  it('различает null и мусор в полях-ссылках', () => {
    expect(sanitizeSettingsPatch({ defaultAgentId: null, execTarget: 'a1', workdir: 7 }))
      .toEqual({ defaultAgentId: null, execTarget: 'a1' })
  })

  it('нормализует инструкции чата и чистит список подсказок', () => {
    const patch = sanitizeSettingsPatch({
      chatInstructions: [{ ...DEFAULT_CHAT_INSTRUCTIONS[0], enabled: false }, { id: 'без названия' }],
      aiAssistPrompts: [{ id: 'p1', title: 'Свой', text: 'текст' }, 'мусор', { title: 'без id' }]
    })
    // Элемент без названия отбрасывается: список инструкций — не свалка.
    expect(patch.chatInstructions).toHaveLength(1)
    expect(patch.chatInstructions?.find((item) => item.id === DEFAULT_CHAT_INSTRUCTIONS[0].id)?.enabled).toBe(false)
    expect(patch.aiAssistPrompts).toEqual([{ id: 'p1', title: 'Свой', text: 'текст', enabled: true }])
  })

  it('не считает патчем не-объект', () => {
    expect(sanitizeSettingsPatch(null)).toEqual({})
    expect(sanitizeSettingsPatch('theme=dark')).toEqual({})
  })
})
