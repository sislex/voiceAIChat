// Гейтинг контекста разговора: какие пункты инспектора можно выключать и как
// выключенный пункт убирается из промпта/инструментов. Чистая логика без БД —
// её используют и строитель снапшота (rest.ts), и сборка хода (turns.ts).

/** Правила безопасности — выключить нельзя (всегда в каждом ходе). */
export const SAFETY_CONTEXT_IDS = ['platform-instructions', 'application-instructions'] as const

/** Чисто информационные пункты (конфигурация/история) — тумблера у них нет. */
export const INFO_CONTEXT_IDS = [
  'working-directory', 'agents-chain', 'llm', 'machine', 'permission-mode',
  'conversation-history', 'current-message'
] as const

/** Можно ли выключить пункт контекста по его id. */
export function isContextToggleable(id: string): boolean {
  if ((SAFETY_CONTEXT_IDS as readonly string[]).includes(id)) return false
  if ((INFO_CONTEXT_IDS as readonly string[]).includes(id)) return false
  return true // personalization, project-binding, skill-*, mcp-remote-*, mcp-kb-*, knowledge-mode
}

/**
 * Имя MCP-инструмента для `--disallowedTools`, если id пункта — MCP-инструмент.
 * `mcp-remote-bash` → `mcp__remote__bash`, `mcp-kb-search` → `mcp__kb__search`.
 */
export function toolNameForContextId(id: string): string | null {
  const remote = /^mcp-remote-(.+)$/.exec(id)
  if (remote) return `mcp__remote__${remote[1]}`
  const kb = /^mcp-kb-(.+)$/.exec(id)
  if (kb) return `mcp__kb__${kb[1]}`
  return null
}

/** Имя навыка из id пункта `skill-<encoded>`, если это навык. */
export function skillNameForContextId(id: string): string | null {
  const match = /^skill-(.+)$/.exec(id)
  return match ? decodeURIComponent(match[1]) : null
}
