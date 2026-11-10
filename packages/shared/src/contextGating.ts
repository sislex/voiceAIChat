// Гейтинг контекста разговора: какие пункты инспектора можно выключать и как
// выключенный пункт убирается из промпта/инструментов. Чистая логика без БД —
// её используют и строитель снапшота (rest.ts), и сборка хода (turns.ts).

/** Служебный маркер встроенного мода «Только обязательное». */
export const REQUIRED_ONLY_CONTEXT_ID = 'required-only'

/** Правила безопасности — выключить нельзя (всегда в каждом ходе). */
export const SAFETY_CONTEXT_IDS = ['platform-instructions', 'application-instructions'] as const

/** Чисто информационные пункты (конфигурация/история) — тумблера у них нет. */
export const INFO_CONTEXT_IDS = [
  'working-directory', 'agents-chain', 'llm', 'machine', 'permission-mode', 'assistant-mode',
  // Автопилот ассистента — настройка разговора, а не блок промпта: у него свой
  // переключатель в карточке. Без этой строки пункт получал тумблер списка,
  // который писал в `disabledContext`, где его никто не читает, — то есть
  // переключатель делал вид, что что-то меняет.
  'assistant-autonomy',
  'conversation-history', 'current-message'
] as const

/**
 * Инструменты, которые подключает сам вид чата: браузерные (`mcp__browser__*`)
 * в чатах с превью, консольные в «Консоли с ассистентом», make-инструменты в
 * Make и канбан-инструменты в ходах панели ассистента. Выключить их тумблером
 * нельзя — они приходят вместе с видом чата, а не из настроек разговора.
 */
const KIND_TOOL_PREFIXES = ['mcp-browser-', 'mcp-console-', 'mcp-make-', 'mcp-kanban-'] as const

/**
 * Почему пункт нельзя выключить. UI показывает замок с пояснением, поэтому
 * причина считается здесь же, где правило, а не выводится по id в компоненте.
 * Выключаемый пункт причины не имеет (null).
 */
export function contextLockReason(id: string): 'safety' | 'info' | 'kind' | null {
  if ((SAFETY_CONTEXT_IDS as readonly string[]).includes(id)) return 'safety'
  if ((INFO_CONTEXT_IDS as readonly string[]).includes(id)) return 'info'
  if (KIND_TOOL_PREFIXES.some((prefix) => id.startsWith(prefix))) return 'kind'
  return null
}

/** Человеческое объяснение замка — один текст на весь интерфейс. */
export const CONTEXT_LOCK_TEXT: Record<'safety' | 'info' | 'kind', string> = {
  safety: 'Правила безопасности платформы и приложения действуют в каждом ходе — выключить их нельзя.',
  info: 'Это справочная информация о конфигурации: отдельным блоком в промпт она не добавляется, выключать нечего.',
  kind: 'Инструмент подключает сам вид чата или привязка задачи (превью, консоль, Make, панель ассистента, макет задачи). Он появляется и исчезает вместе с этой связью, тумблера у него нет.'
}

/** Можно ли выключить пункт контекста по его id. */
export function isContextToggleable(id: string): boolean {
  if (id === REQUIRED_ONLY_CONTEXT_ID) return true // служебный выключатель всех необязательных источников
  if ((SAFETY_CONTEXT_IDS as readonly string[]).includes(id)) return false
  if ((INFO_CONTEXT_IDS as readonly string[]).includes(id)) return false
  if (KIND_TOOL_PREFIXES.some((prefix) => id.startsWith(prefix))) return false
  return true // personalization, project-binding, skill-*, mcp-remote-*, mcp-kb-*, knowledge-mode
}

/** Учитывает как отдельный тумблер, так и встроенный мод «Только обязательное». */
export function isContextDisabled(disabledContext: Iterable<string>, id: string): boolean {
  const disabled = disabledContext instanceof Set ? disabledContext : new Set(disabledContext)
  return disabled.has(id) || (disabled.has(REQUIRED_ONLY_CONTEXT_ID) && isContextToggleable(id))
}

/**
 * Имя MCP-инструмента для `--disallowedTools`, если id пункта — MCP-инструмент.
 * `mcp-remote-bash` → `mcp__remote__bash`, `mcp-kb-search` → `mcp__kb__search`.
 * The server-level `mcp-history` toggle disables both history tools with a wildcard.
 */
export function toolNameForContextId(id: string): string | null {
  if (id === 'mcp-history') return 'mcp__history__*'
  const remote = /^mcp-remote-(.+)$/.exec(id)
  if (remote) return `mcp__remote__${remote[1]}`
  const kb = /^mcp-kb-(.+)$/.exec(id)
  if (kb) return `mcp__kb__${kb[1]}`
  const history = /^mcp-history-(.+)$/.exec(id)
  if (history) return `mcp__history__${history[1]}`
  return null
}

/** Имя навыка из id пункта `skill-<encoded>`, если это навык. */
export function skillNameForContextId(id: string): string | null {
  const match = /^skill-(.+)$/.exec(id)
  return match ? decodeURIComponent(match[1]) : null
}
