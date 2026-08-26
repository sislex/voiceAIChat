// Инструкции чата — тексты, которые сервер дописывает к каждому промпту: встроенные
// подсказки о служебных fenced-блоках (открыть терминал, задать вопросы с вариантами,
// показать картинку, спросить разрешение) и пользовательские. Хранятся в
// `Settings.chatInstructions`; отдельный чат может выключить любую через инспектор
// контекста (id пункта `instruction-<id>` в `disabledContext`). Выключенная встроенная
// инструкция не только уходит из промпта — её ответный блок вырезается из ответа.

import { IMAGE_HINT } from './images'
import { CHANGE_AUTHORIZATION_HINT } from './prompt'
import { QUESTIONS_HINT } from './questions'
import { parseToolBlock, toolHint, type ToolSpec } from './tools'
import { DEFAULT_CHAT_INSTRUCTIONS, type ChatInstruction, type ChatInstructionKind } from './types'

/** Префикс id пункта инспектора контекста для инструкции чата. */
export const INSTRUCTION_CONTEXT_PREFIX = 'instruction-'
export function instructionContextId(id: string): string {
  return `${INSTRUCTION_CONTEXT_PREFIX}${encodeURIComponent(id)}`
}
/** id инструкции из id пункта контекста; null — пункт не про инструкцию. */
export function instructionIdForContextId(contextId: string): string | null {
  return contextId.startsWith(INSTRUCTION_CONTEXT_PREFIX) ? decodeURIComponent(contextId.slice(INSTRUCTION_CONTEXT_PREFIX.length)) : null
}

/** Стандартный текст встроенного вида — то, что пользователь видит и правит в настройках. */
export function standardInstructionText(kind: ChatInstructionKind): string {
  switch (kind) {
    case 'console': return toolHint(['console'])
    case 'explorer': return toolHint(['explorer'])
    case 'questions': return QUESTIONS_HINT
    case 'image': return IMAGE_HINT
    case 'taskLaunch': return CHANGE_AUTHORIZATION_HINT
  }
}

/** Эффективный текст инструкции: правка пользователя, иначе стандартный (у своей — только свой). */
export function instructionText(item: ChatInstruction): string {
  const own = item.text?.trim()
  if (own) return own
  return item.kind ? standardInstructionText(item.kind) : ''
}

/** Встроенные виды, которых нет в списке (удалены) — их можно восстановить. */
export function missingBuiltinInstructions(list: readonly ChatInstruction[]): ChatInstruction[] {
  const kinds = new Set(list.map((item) => item.kind).filter(Boolean))
  return DEFAULT_CHAT_INSTRUCTIONS.filter((item) => !kinds.has(item.kind)).map((item) => ({ ...item }))
}

/**
 * Инструкции, которые реально уйдут в ход: включены в настройках и не выключены
 * в этом чате (`disabledContext`).
 */
export function effectiveChatInstructions(list: readonly ChatInstruction[], disabledContext: Iterable<string> = []): ChatInstruction[] {
  const disabled = new Set(disabledContext)
  return list.filter((item) => item.enabled && !disabled.has(instructionContextId(item.id)))
}

/**
 * Тексты подсказок в порядке списка. Стандартные консоль и проводник без правок
 * склеиваются в одну tool-подсказку (как было изначально) — модели так яснее.
 */
export function chatInstructionHints(effective: readonly ChatInstruction[]): string[] {
  const standardTool = (kind: ToolSpec['kind']): boolean =>
    effective.some((item) => item.kind === kind && !item.text?.trim())
  const mergeTool = standardTool('console') && standardTool('explorer')
  const out: string[] = []
  let toolEmitted = false
  for (const item of effective) {
    if (mergeTool && (item.kind === 'console' || item.kind === 'explorer')) {
      if (!toolEmitted) { out.push(toolHint(['console', 'explorer'])); toolEmitted = true }
      continue
    }
    const text = instructionText(item)
    if (text) out.push(text)
  }
  return out
}

/** Дописывает к непустому промпту эффективные инструкции (пустой промпт не трогает). */
export function appendChatInstructionHints(prompt: string, effective: readonly ChatInstruction[]): string {
  if (!prompt.trim()) return prompt
  const hints = chatInstructionHints(effective)
  return hints.length ? `${prompt}\n\n${hints.join('\n\n')}` : prompt
}

/** Все блоки данного fence-языка (с хвостовым переводом строки) → пусто. */
function stripFence(text: string, lang: string): string {
  const re = new RegExp('\\n?```' + lang + '[^\\S\\n]*\\n[\\s\\S]*?```[^\\S\\n]*', 'g')
  return text.replace(re, '')
}

/**
 * Вырезает из ответа блоки встроенных видов, которых нет среди эффективных
 * инструкций. Убрать подсказку из промпта недостаточно: модель помнит формат по
 * истории сессии и может выдать блок сама — тогда виджет открылся бы вопреки
 * настройке. Блоки разрешённых видов не трогаем.
 */
export function stripDisabledInstructionBlocks(text: string, effective: readonly ChatInstruction[]): string {
  const kinds = new Set(effective.map((item) => item.kind).filter(Boolean))
  let out = text
  if (!kinds.has('questions')) out = stripFence(out, 'questions')
  if (!kinds.has('image')) out = stripFence(out, 'image')
  if (!kinds.has('taskLaunch')) out = stripFence(out, 'task-launch')
  if (!kinds.has('console') || !kinds.has('explorer')) {
    const parsed = parseToolBlock(out)
    // Битый JSON parseToolBlock не разбирает — такой блок UI и так не откроет.
    if (parsed && !kinds.has(parsed.tool.kind)) out = parsed.body
  }
  return out.trimEnd()
}
