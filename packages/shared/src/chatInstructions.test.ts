import { describe, expect, it } from 'vitest'
import { appendChatInstructionHints, chatInstructionHints } from './chatInstructions'
import { DEFAULT_CHAT_INSTRUCTIONS } from './types'
import { IMAGE_HINT } from './images'
import { CHANGE_AUTHORIZATION_HINT } from './prompt'
import { QUESTIONS_HINT } from './questions'
import { TOOL_HINT, toolHint } from './tools'

describe('chatInstructions', () => {
  it('по умолчанию (и без настройки) в промпт идут все четыре подсказки в прежнем порядке', () => {
    const expected = [QUESTIONS_HINT, TOOL_HINT, IMAGE_HINT, CHANGE_AUTHORIZATION_HINT]
    expect(chatInstructionHints(undefined)).toEqual(expected)
    expect(chatInstructionHints(DEFAULT_CHAT_INSTRUCTIONS)).toEqual(expected)
    expect(appendChatInstructionHints('Привет', undefined)).toBe(`Привет\n\n${expected.join('\n\n')}`)
  })

  it('выключенная консоль убирает её из tool-подсказки, проводник остаётся', () => {
    const hints = chatInstructionHints({ console: false })
    expect(hints).toContain(toolHint(['explorer']))
    expect(hints.join('\n')).not.toContain('"kind": "console"')
    expect(hints.join('\n')).toContain('"kind": "explorer"')
  })

  it('оба вида утилит выключены — tool-подсказки нет вовсе', () => {
    const hints = chatInstructionHints({ console: false, explorer: false })
    expect(hints.join('\n')).not.toContain('```tool')
    expect(hints).toEqual([QUESTIONS_HINT, IMAGE_HINT, CHANGE_AUTHORIZATION_HINT])
  })

  it('все инструкции выключены — промпт не меняется; пустой промпт не трогаем', () => {
    const off = { console: false, explorer: false, questions: false, image: false, taskLaunch: false }
    expect(appendChatInstructionHints('Привет', off)).toBe('Привет')
    expect(appendChatInstructionHints('   ', undefined)).toBe('   ')
  })
})
