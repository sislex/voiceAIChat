// Инструкции чата — подсказки модели о служебных fenced-блоках (открыть терминал,
// задать вопросы с вариантами, показать картинку…). Каждую пользователь может
// выключить в настройках: тогда её текст не попадает в промпт, и модель не знает,
// как выполнить такую просьбу. Сами парсеры блоков живут рядом (tools/questions/…);
// здесь — только каталог для UI и сборка подсказок по включённым пунктам.

import { IMAGE_HINT } from './images'
import { CHANGE_AUTHORIZATION_HINT } from './prompt'
import { QUESTIONS_HINT } from './questions'
import { parseToolBlock, toolHint, type ToolSpec } from './tools'
import type { ChatInstructionId, ChatInstructionSettings } from './types'

export interface ChatInstructionInfo {
  id: ChatInstructionId
  title: string
  /** Что умеет модель, пока инструкция включена, — текст для настроек. */
  description: string
}

/** Каталог для раздела «Инструкции» в настройках; порядок — порядок в UI. */
export const CHAT_INSTRUCTIONS: readonly ChatInstructionInfo[] = [
  { id: 'console', title: 'Открывать терминал в чате', description: 'По просьбе «открой консоль» модель вставляет в ответ живой терминал машины.' },
  { id: 'explorer', title: 'Открывать проводник в чате', description: 'По просьбе «открой проводник» модель вставляет файловый проводник машины.' },
  { id: 'questions', title: 'Уточняющие вопросы с вариантами', description: 'Модель может закончить ответ вопросами с кнопками-вариантами ответа.' },
  { id: 'image', title: 'Показывать созданные изображения', description: 'Файл-картинку, созданный на машине, модель показывает прямо в сообщении.' },
  { id: 'taskLaunch', title: 'Спрашивать разрешение перед изменением проекта', description: 'Перед правкой файлов модель предлагает завести задачу в канбан или работать в чате.' }
]

export function isChatInstructionEnabled(settings: ChatInstructionSettings | undefined, id: ChatInstructionId): boolean {
  return settings?.[id] !== false
}

/** Тексты включённых подсказок в порядке, в каком они всегда шли в промпт. */
export function chatInstructionHints(settings: ChatInstructionSettings | undefined): string[] {
  const on = (id: ChatInstructionId): boolean => isChatInstructionEnabled(settings, id)
  const kinds: ToolSpec['kind'][] = []
  if (on('console')) kinds.push('console')
  if (on('explorer')) kinds.push('explorer')
  return [
    on('questions') ? QUESTIONS_HINT : '',
    toolHint(kinds),
    on('image') ? IMAGE_HINT : '',
    on('taskLaunch') ? CHANGE_AUTHORIZATION_HINT : ''
  ].filter(Boolean)
}

/** Дописывает к непустому промпту включённые инструкции (пустой промпт не трогает). */
export function appendChatInstructionHints(prompt: string, settings: ChatInstructionSettings | undefined): string {
  if (!prompt.trim()) return prompt
  const hints = chatInstructionHints(settings)
  return hints.length ? `${prompt}\n\n${hints.join('\n\n')}` : prompt
}

/** Все блоки данного fence-языка (с хвостовым переводом строки) → пусто. */
function stripFence(text: string, lang: string): string {
  const re = new RegExp('\\n?```' + lang + '[^\\S\\n]*\\n[\\s\\S]*?```[^\\S\\n]*', 'g')
  return text.replace(re, '')
}

/**
 * Вырезает из ответа блоки выключенных инструкций. Убрать подсказку из промпта
 * недостаточно: модель помнит формат по истории сессии и может выдать блок сама —
 * тогда виджет открылся бы вопреки настройке. Включённые блоки не трогаем,
 * tool-блок с разрешённым kind тоже остаётся.
 */
export function stripDisabledInstructionBlocks(text: string, settings: ChatInstructionSettings | undefined): string {
  let out = text
  const on = (id: ChatInstructionId): boolean => isChatInstructionEnabled(settings, id)
  if (!on('questions')) out = stripFence(out, 'questions')
  if (!on('image')) out = stripFence(out, 'image')
  if (!on('taskLaunch')) out = stripFence(out, 'task-launch')
  if (!on('console') || !on('explorer')) {
    const parsed = parseToolBlock(out)
    // Битый JSON parseToolBlock не разбирает — такой блок UI и так не откроет.
    if (parsed && !on(parsed.tool.kind)) out = parsed.body
  }
  return out.trimEnd()
}
