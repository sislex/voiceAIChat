import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { EnginesObserver } from './EnginesObserver'
import type { SessionUsage } from '@voicechat/shared'

const ccUsage: SessionUsage = {
  model: 'claude-opus-4-8',
  inputTokens: 1200,
  outputTokens: 800,
  cacheReadTokens: 5000,
  cacheCreationTokens: 0,
  costUsd: 0.1234,
  turns: 3
}

function base(engine: 'claude' | 'codex', onSwitchEngine = vi.fn()) {
  return {
    variant: 'page' as const,
    engine,
    onSwitchEngine,
    onClose: vi.fn(),
    claude: {
      projects: [{ slug: '-a', path: '/a', name: 'projA', sessionCount: 1, lastActivity: 1 }],
      sessions: [{ id: 's1', title: 'Сессия CC', updatedAt: 1, sizeBytes: 1 }],
      transcript: [{ kind: 'assistant' as const, text: 'привет из CC' }],
      activeProject: '-a',
      activeSession: 's1',
      usage: ccUsage,
      onSelectProject: vi.fn(),
      onSelectSession: vi.fn(),
      onResumeSession: vi.fn()
    },
    codex: {
      projects: [{ cwd: '/c', name: 'projC', sessionCount: 1, lastActivity: 1 }],
      sessions: [{ id: 'x1', title: 'Сессия CX', updatedAt: 1, sizeBytes: 1 }],
      transcript: [{ kind: 'assistant' as const, text: 'привет из CX' }],
      activeProject: '/c',
      activeSession: 'x1',
      usage: null,
      onSelectProject: vi.fn(),
      onSelectSession: vi.fn(),
      onResumeSession: vi.fn()
    }
  }
}

describe('EnginesObserver', () => {
  it('движок Claude: показывает тело CC и сводку (модель/токены/стоимость)', () => {
    render(<EnginesObserver {...base('claude')} />)
    expect(screen.getByRole('heading', { name: 'История LLM' })).toBeInTheDocument()
    expect(screen.getByTestId('cc-transcript')).toHaveTextContent('привет из CC')
    const bar = screen.getByTestId('usage-bar')
    expect(bar).toHaveTextContent('claude-opus-4-8')
    expect(bar).toHaveTextContent('7.0k') // 1200+800+5000
    expect(bar).toHaveTextContent('$0.12')
  })

  it('переключатель зовёт onSwitchEngine', () => {
    const onSwitchEngine = vi.fn()
    render(<EnginesObserver {...base('claude', onSwitchEngine)} />)
    fireEvent.click(screen.getByRole('tab', { name: /Codex/ }))
    expect(onSwitchEngine).toHaveBeenCalledWith('codex')
  })

  it('движок Codex: тело CX, пустая сводка без выбранной сессии → подсказка', () => {
    render(<EnginesObserver {...base('codex')} />)
    expect(screen.getByTestId('cx-transcript')).toHaveTextContent('привет из CX')
    expect(screen.getByTestId('usage-bar')).toHaveTextContent('Выберите сессию')
  })

  it('активная вкладка соответствует движку', () => {
    render(<EnginesObserver {...base('codex')} />)
    const tabs = screen.getAllByRole('tab')
    const codexTab = tabs.find((t) => within(t).queryByText(/Codex/) || t.textContent?.includes('Codex'))
    expect(codexTab).toHaveAttribute('aria-selected', 'true')
  })
})
