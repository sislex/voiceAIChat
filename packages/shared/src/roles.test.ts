import { describe, it, expect } from 'vitest'
import {
  activeStatusLabel,
  chatModeLabel,
  CLAUDE_MODELS,
  clampModelForRole,
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  isModelAllowed,
  modelsForRole,
  normalizeClaudeModel
} from './types'

describe('модели по роли', () => {
  it('admin имеет доступ ко всем моделям', () => {
    expect(modelsForRole('admin')).toHaveLength(CLAUDE_MODELS.length)
    for (const m of CLAUDE_MODELS) expect(isModelAllowed(m.id, 'admin')).toBe(true)
  })

  it('user — без opus и fable (default/sonnet/haiku)', () => {
    // Default остаётся всем: это выбор самого CLI, а не явно взятая дорогая модель.
    expect(modelsForRole('user').map((m) => m.id)).toEqual(['default', 'sonnet', 'haiku'])
    expect(isModelAllowed('opus[1m]', 'user')).toBe(false)
    expect(isModelAllowed('fable', 'user')).toBe(false)
    expect(isModelAllowed('default', 'user')).toBe(true)
    expect(isModelAllowed('sonnet', 'user')).toBe(true)
    expect(isModelAllowed('haiku', 'user')).toBe(true)
  })

  it('clampModelForRole откатывает запрещённую модель к sonnet', () => {
    expect(clampModelForRole('opus[1m]', 'user')).toBe('sonnet')
    expect(clampModelForRole('fable', 'user')).toBe('sonnet')
    expect(clampModelForRole('haiku', 'user')).toBe('haiku')
    // admin не клампится.
    expect(clampModelForRole('opus[1m]', 'admin')).toBe('opus[1m]')
  })
})

describe('меню моделей Claude', () => {
  it('повторяет список CLI по порядку и id', () => {
    expect(CLAUDE_MODELS.map((m) => m.id)).toEqual(['default', 'opus[1m]', 'fable', 'sonnet', 'haiku'])
    expect(CLAUDE_MODELS.map((m) => m.label)).toEqual([
      'Default (recommended)', 'Opus (1M context)', 'Fable', 'Sonnet', 'Haiku'
    ])
  })

  it('нормализует старые значения настроек в пункты меню', () => {
    expect(normalizeClaudeModel('opus')).toBe('opus[1m]')
    expect(normalizeClaudeModel('opus-4.5')).toBe('opus[1m]')
    expect(normalizeClaudeModel('opus[1m]')).toBe('opus[1m]')
    expect(normalizeClaudeModel('sonnet-4.5')).toBe('sonnet')
    expect(normalizeClaudeModel('claude-haiku-4-5')).toBe('haiku')
    expect(normalizeClaudeModel('')).toBe('default')
    expect(normalizeClaudeModel('gpt-5.5')).toBe('default')
  })
})

describe('подписи режима чата (карточка в сайдбаре)', () => {
  it('слово на каждый пункт «Режима разговора»', () => {
    expect(chatModeLabel('plan')).toBe('план')
    expect(chatModeLabel('acceptEdits')).toBe('разработка')
    expect(chatModeLabel('bypassPermissions')).toBe('задача')
  })

  it('свой режим не задан — берём действующий дефолт пользователя', () => {
    expect(chatModeLabel(null, 'plan')).toBe('план')
    expect(chatModeLabel(undefined, 'acceptEdits')).toBe('разработка')
    // Без явного дефолта — как в DEFAULT_SETTINGS.
    expect(chatModeLabel(null)).toBe('задача')
  })

  it('во время хода к тому же слову добавляется «идет»', () => {
    expect(activeStatusLabel('plan')).toBe('идет план')
    expect(activeStatusLabel('acceptEdits')).toBe('идет разработка')
    expect(activeStatusLabel(null, 'bypassPermissions')).toBe('идет задача')
  })
})

describe('меню моделей Codex', () => {
  it('повторяет список CLI по порядку; id = то, что уходит в `codex -m`', () => {
    expect(CODEX_MODELS.map((m) => m.id)).toEqual([
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'
    ])
    expect(CODEX_MODELS.every((m) => m.label === m.id)).toBe(true)
    expect(DEFAULT_CODEX_MODEL).toBe('gpt-5.6-sol')
  })
})
