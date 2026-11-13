// Гейтинг контекста разговора: какие пункты инспектора можно выключать и как
// выключенный пункт убирается из промпта/инструментов. Чистая логика без БД —
// её используют и строитель снапшота (rest.ts), и сборка хода (turns.ts).

/** Служебный маркер встроенного базового мода Required. */
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
 * Инструменты вида чата всё ещё подключаются только подходящей поверхностью,
 * но пользователь может исключить их из конкретного мода или разговора.
 * Карта ниже превращает стабильный id снимка в wildcard для deny-list CLI.
 */
const CONTEXT_TOOL_NAMES: Readonly<Record<string, string>> = {
  'mcp-browser-preview': 'mcp__browser__*',
  'mcp-console-pty': 'mcp__console__*',
  'mcp-make-files': 'mcp__make__*',
  'mcp-make-design': 'mcp__make_design_*__*',
  'mcp-kanban-board': 'mcp__kanban__*'
}

/** Все MCP-источники снимка, которые базовый Required может исключить. */
export const CONTEXT_MCP_ITEM_IDS = [
  'mcp-remote-machines', 'mcp-remote-read', 'mcp-remote-edit', 'mcp-remote-bash',
  'mcp-browser-preview', 'mcp-console-pty', 'mcp-make-files', 'mcp-make-design', 'mcp-kanban-board',
  'mcp-kb-search', 'mcp-kb-document', 'mcp-kb-topics', 'mcp-history'
] as const

/**
 * Почему пункт нельзя выключить. UI показывает замок с пояснением, поэтому
 * причина считается здесь же, где правило, а не выводится по id в компоненте.
 * Выключаемый пункт причины не имеет (null).
 */
export function contextLockReason(id: string): 'safety' | 'info' | 'kind' | null {
  if ((SAFETY_CONTEXT_IDS as readonly string[]).includes(id)) return 'safety'
  if ((INFO_CONTEXT_IDS as readonly string[]).includes(id)) return 'info'
  return null
}

/** Человеческое объяснение замка — один текст на весь интерфейс. */
export const CONTEXT_LOCK_TEXT: Record<'safety' | 'info' | 'kind' | 'required', string> = {
  safety: 'Правила безопасности платформы и приложения действуют в каждом ходе — выключить их нельзя.',
  info: 'Это справочная информация о конфигурации: отдельным блоком в промпт она не добавляется, выключать нечего.',
  kind: 'Инструмент подключает сам вид чата или привязка задачи (превью, консоль, Make, панель ассистента, макет задачи). Он появляется и исчезает вместе с этой связью, тумблера у него нет.',
  required: 'Источник включён в базовом моде Required и обязателен для всех наследующих модов.'
}

/** Можно ли выключить пункт контекста по его id. */
export function isContextToggleable(id: string): boolean {
  if (id === REQUIRED_ONLY_CONTEXT_ID) return true // служебный выключатель всех необязательных источников
  if ((SAFETY_CONTEXT_IDS as readonly string[]).includes(id)) return false
  if ((INFO_CONTEXT_IDS as readonly string[]).includes(id)) return false
  return true // context blocks, skills and every MCP family can be configured by mode
}

/** Учитывает тумблер мода и Required, который наследует каждый другой мод. */
export function isContextDisabled(disabledContext: Iterable<string>, id: string, requiredContext: Iterable<string> = []): boolean {
  const disabled = disabledContext instanceof Set ? disabledContext : new Set(disabledContext)
  const required = requiredContext instanceof Set ? requiredContext : new Set(requiredContext)
  if (required.has(id)) return false
  return disabled.has(id) || (disabled.has(REQUIRED_ONLY_CONTEXT_ID) && isContextToggleable(id))
}

/** Удаляет из выключений обязательные источники, сохраняя маркер Required. */
export function effectiveDisabledContext(disabledContext: Iterable<string>, requiredContext: Iterable<string>): Set<string> {
  const required = requiredContext instanceof Set ? requiredContext : new Set(requiredContext)
  return new Set([...disabledContext].filter((id) => !required.has(id)))
}

/**
 * Имя MCP-инструмента для `--disallowedTools`, если id пункта — MCP-инструмент.
 * `mcp-remote-bash` → `mcp__remote__bash`, `mcp-kb-search` → `mcp__kb__search`.
 * The server-level `mcp-history` toggle disables both history tools with a wildcard.
 */
export function toolNameForContextId(id: string): string | null {
  if (CONTEXT_TOOL_NAMES[id]) return CONTEXT_TOOL_NAMES[id]!
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
