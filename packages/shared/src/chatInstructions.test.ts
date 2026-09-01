import { describe, expect, it } from 'vitest'
import {
  appendChatInstructionHints, chatInstructionHints, effectiveChatInstructions, instructionContextId,
  instructionIdForContextId, instructionText, missingBuiltinInstructions, stripDisabledInstructionBlocks
, instructionsForAssistantKind } from './chatInstructions'
import { IMAGE_HINT } from './images'
import { CHANGE_AUTHORIZATION_HINT } from './prompt'
import { QUESTIONS_HINT } from './questions'
import { TOOL_HINT, toolHint } from './tools'
import { DEFAULT_CHAT_INSTRUCTIONS, normalizeChatInstructions, type ChatInstruction } from './types'

const all = DEFAULT_CHAT_INSTRUCTIONS
const without = (...ids: string[]): ChatInstruction[] => all.filter((item) => !ids.includes(item.id))

describe('chatInstructions', () => {
  it('стандартный набор даёт четыре подсказки в прежнем порядке: консоль+проводник склеены', () => {
    expect(chatInstructionHints(all)).toEqual([TOOL_HINT, QUESTIONS_HINT, IMAGE_HINT, CHANGE_AUTHORIZATION_HINT])
    expect(appendChatInstructionHints('Привет', all)).toBe(`Привет\n\n${[TOOL_HINT, QUESTIONS_HINT, IMAGE_HINT, CHANGE_AUTHORIZATION_HINT].join('\n\n')}`)
    expect(appendChatInstructionHints('  ', all)).toBe('  ')
  })

  it('без консоли остаётся отдельная подсказка проводника; без обоих tool-подсказки нет', () => {
    const one = chatInstructionHints(without('console'))
    expect(one[0]).toBe(toolHint(['explorer']))
    expect(one.join('\n')).not.toContain('"kind": "console"')
    expect(chatInstructionHints(without('console', 'explorer')).join('\n')).not.toContain('```tool')
  })

  it('правка текста встроенной и своя инструкция идут как есть, в порядке списка', () => {
    const list: ChatInstruction[] = [
      { id: 'custom', title: 'Своя', description: '', enabled: true, text: 'Отвечай стихами.' },
      { ...all[0], text: 'Мой текст про консоль' },
      all[1]
    ]
    expect(chatInstructionHints(list)).toEqual(['Отвечай стихами.', 'Мой текст про консоль', toolHint(['explorer'])])
    expect(instructionText({ id: 'x', title: 'x', description: '', enabled: true })).toBe('')
  })

  it('эффективные = включённые в настройках и не выключенные в чате', () => {
    const list = all.map((item) => item.id === 'image' ? { ...item, enabled: false } : item)
    const eff = effectiveChatInstructions(list, [instructionContextId('console')])
    expect(eff.map((item) => item.id)).toEqual(['explorer', 'questions', 'taskLaunch'])
    expect(instructionIdForContextId(instructionContextId('a b'))).toBe('a b')
    expect(instructionIdForContextId('skill-x')).toBeNull()
  })

  it('normalizeChatInstructions принимает старый формат флагов и отсутствие значения', () => {
    expect(normalizeChatInstructions(undefined)).toEqual(all)
    expect(normalizeChatInstructions({ console: false }).find((item) => item.id === 'console')?.enabled).toBe(false)
    expect(normalizeChatInstructions([{ id: 'c', title: 'C' }])).toEqual([{ id: 'c', title: 'C', enabled: true, description: '' }])
    expect(normalizeChatInstructions([])).toEqual([])
    expect(missingBuiltinInstructions(without('image', 'questions')).map((item) => item.id)).toEqual(['questions', 'image'])
  })

  describe('stripDisabledInstructionBlocks', () => {
    const answer = 'Открываю.\n\n```tool\n{"kind":"console"}\n```\n\n```questions\n[{"q":"Дальше?","options":["Да","Нет"]}]\n```\n\n```image\n{"path":"/tmp/a.png"}\n```\n\n```task-launch\n{"title":"t","description":"d","acceptanceCriteria":"a"}\n```'

    it('при полном наборе текст не меняется', () => {
      expect(stripDisabledInstructionBlocks(answer, all)).toBe(answer)
    })

    it('вырезает только блоки отсутствующих видов', () => {
      expect(stripDisabledInstructionBlocks(answer, without('questions', 'image', 'taskLaunch'))).toBe('Открываю.\n\n```tool\n{"kind":"console"}\n```')
    })

    it('tool-блок убирается только если нет именно его kind', () => {
      const tool = 'Вот.\n\n```tool\n{"kind":"console"}\n```'
      expect(stripDisabledInstructionBlocks(tool, without('explorer'))).toBe(tool)
      expect(stripDisabledInstructionBlocks(tool, without('console'))).toBe('Вот.')
    })
  })
})

describe('instructionsForAssistantKind — вид чата решает, что уйдёт', () => {
  const list: ChatInstruction[] = [
    { id: 'console', title: 'Открывать терминал в чате', description: '', text: '', enabled: true, kind: 'console' },
    { id: 'task-launch', title: 'Заводить задачу', description: '', text: '', enabled: true, kind: 'taskLaunch' },
    { id: 'questions', title: 'Уточняющие вопросы', description: '', text: '', enabled: true, kind: 'questions' }
  ]

  it('обычный чат получает всё', () => {
    expect(instructionsForAssistantKind(list, null).map((item) => item.id)).toEqual(['console', 'task-launch', 'questions'])
  })

  it('в консоли с ассистентом нет подсказки про терминал: он уже открыт справа', () => {
    expect(instructionsForAssistantKind(list, 'console-reader').map((item) => item.id)).toEqual(['task-launch', 'questions'])
  })

  it('в Make нет ни терминала, ни «завести задачу» — правка проекта и есть задача чата', () => {
    expect(instructionsForAssistantKind(list, 'make').map((item) => item.id)).toEqual(['questions'])
  })
})
