import { describe, expect, it } from 'vitest'
import { REQUIRED_ONLY_CONTEXT_ID, effectiveDisabledContext, isContextDisabled, isContextToggleable, toolNameForContextId, skillNameForContextId } from './contextGating.js'

describe('contextGating', () => {
  it('безопасность и служебную информацию выключить нельзя', () => {
    expect(isContextToggleable('platform-instructions')).toBe(false)
    expect(isContextToggleable('application-instructions')).toBe(false)
    expect(isContextToggleable('working-directory')).toBe(false)
    expect(isContextToggleable('agents-chain')).toBe(false)
    expect(isContextToggleable('conversation-history')).toBe(false)
    expect(isContextToggleable('current-message')).toBe(false)
  })

  it('инструкции/инструменты/навыки/kb — можно', () => {
    expect(isContextToggleable('personalization')).toBe(true)
    expect(isContextToggleable('project-binding')).toBe(true)
    expect(isContextToggleable('knowledge-mode')).toBe(true)
    expect(isContextToggleable('skill-Refactor')).toBe(true)
    expect(isContextToggleable('mcp-remote-bash')).toBe(true)
    expect(isContextToggleable('mcp-kb-search')).toBe(true)
    expect(isContextToggleable('mcp-history')).toBe(true)
  })

  it('Required выключает необязательные источники, но обязательные наследуются включёнными', () => {
    expect(isContextToggleable(REQUIRED_ONLY_CONTEXT_ID)).toBe(true)
    expect(isContextDisabled([REQUIRED_ONLY_CONTEXT_ID], 'personalization')).toBe(true)
    expect(isContextDisabled([REQUIRED_ONLY_CONTEXT_ID], 'instruction-console', ['instruction-console'])).toBe(false)
    expect(isContextDisabled(['instruction-console'], 'instruction-console', ['instruction-console'])).toBe(false)
    expect(isContextDisabled([REQUIRED_ONLY_CONTEXT_ID], 'platform-instructions')).toBe(false)
    expect(effectiveDisabledContext(['instruction-console', 'mcp-kb-search'], ['instruction-console']))
      .toEqual(new Set(['mcp-kb-search']))
  })

  it('id инструмента маппится в имя MCP-инструмента', () => {
    expect(toolNameForContextId('mcp-remote-bash')).toBe('mcp__remote__bash')
    expect(toolNameForContextId('mcp-kb-search')).toBe('mcp__kb__search')
    expect(toolNameForContextId('mcp-kb-document')).toBe('mcp__kb__document')
    expect(toolNameForContextId('mcp-history')).toBe('mcp__history__*')
    expect(toolNameForContextId('personalization')).toBeNull()
    expect(toolNameForContextId('skill-X')).toBeNull()
  })

  it('имя навыка из id (декодируется)', () => {
    expect(skillNameForContextId('skill-Refactor')).toBe('Refactor')
    expect(skillNameForContextId(`skill-${encodeURIComponent('Дизайн UI')}`)).toBe('Дизайн UI')
    expect(skillNameForContextId('mcp-kb-search')).toBeNull()
  })
})
