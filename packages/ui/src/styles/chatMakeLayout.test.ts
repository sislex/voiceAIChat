// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { atRuleBodies, atRuleBody, decl } from './cssRules'

describe('app.css — chat и Make split layout', () => {
  it('сохраняет сжимаемую flex-цепочку split-чата', () => {
    expect(decl('.chat-split', 'height')).toBe('100%')
    expect(decl('.chat-split', 'min-width')).toBe('0')
    expect(decl('.chat-split', 'min-height')).toBe('0')
    expect(decl('.chat-split', 'overflow')).toBe('clip')
    expect(decl('.chat-split-chat', 'display')).toBe('flex')
    expect(decl('.chat-split-chat', 'flex-direction')).toBe('column')
    expect(decl('.chat-split-chat', 'min-width')).toBe('360px')
    expect(decl('.chat-split-chat', 'min-height')).toBe('0')
    expect(decl('.chat-split-chat > .main', 'flex')).toBe('1 1 auto')
    expect(decl('.chat-split-chat > .main', 'height')).toBe('auto')
  })

  it('не даёт длинному заголовку распирать узкую колонку', () => {
    expect(decl('.chat-split .mhead', 'padding-inline')).toBe('14px')
    expect(decl('.mtitle', 'min-width')).toBe('0')
    expect(decl('.mtitle', 'overflow')).toBe('hidden')
    expect(decl('.mtitle', 'text-overflow')).toBe('ellipsis')
    expect(decl('.mtitle', 'white-space')).toBe('nowrap')
  })

  it('адаптирует композер по ширине его контейнера', () => {
    expect(decl('.voicebar', 'min-width')).toBe('0')
    expect(decl('.voicebar', 'container')).toBe('composer / inline-size')
    const compact = atRuleBody('@container composer (max-width: 560px)')
    expect(compact).toMatch(/\.mode-menu__label[^}]*display:\s*none/s)
    expect(compact).toMatch(/\.mode-menu__list[^}]*max-width:\s*calc\(100cqw - 24px\)/s)
  })

  it('mobile снимает desktop minimum колонки чата', () => {
    const mobile = atRuleBodies('@media (max-width: 768px)').join('\n')
    expect(mobile).toMatch(/\.chat-split-chat[^}]*min-width:\s*0/s)
  })
})
