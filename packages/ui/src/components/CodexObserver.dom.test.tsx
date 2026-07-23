import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodexObserver } from './CodexObserver'
import type { CxProject, CxSession, CxItem } from '@shared/codexSessions'

const projects: CxProject[] = [
  { cwd: '/U/x/a', name: 'projA', sessionCount: 2, lastActivity: Date.now() }
]
const sessions: CxSession[] = [{ id: 'sid-1', title: 'Первая сессия', updatedAt: Date.now(), sizeBytes: 10 }]
const transcript: CxItem[] = [
  { kind: 'user', text: 'Сделай фичу' },
  { kind: 'assistant', text: 'Готово **ок**' },
  { kind: 'tool_use', text: '$ ls' },
  { kind: 'tool_result', text: 'ошибка', isError: true }
]

function renderObs(props: Partial<Parameters<typeof CodexObserver>[0]> = {}): void {
  render(
    <CodexObserver
      projects={projects}
      sessions={sessions}
      transcript={transcript}
      activeProject={null}
      activeSession={null}
      onSelectProject={vi.fn()}
      onSelectSession={vi.fn()}
      onResumeSession={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  )
}

describe('CodexObserver', () => {
  it('рендерит проекты и зовёт onSelectProject с cwd', () => {
    const onSelectProject = vi.fn()
    renderObs({ onSelectProject })
    fireEvent.click(screen.getByText('projA'))
    expect(onSelectProject).toHaveBeenCalledWith('/U/x/a')
  })

  it('сессии выбранного проекта → onSelectSession с id', () => {
    const onSelectSession = vi.fn()
    renderObs({ activeProject: '/U/x/a', onSelectSession })
    fireEvent.click(screen.getByText('Первая сессия'))
    expect(onSelectSession).toHaveBeenCalledWith('sid-1')
  })

  it('транскрипт: сообщения + активность, live-индикатор при выбранной сессии', () => {
    renderObs({ activeProject: '/U/x/a', activeSession: 'sid-1' })
    const t = screen.getByTestId('cx-transcript')
    expect(t).toHaveTextContent('Сделай фичу')
    expect(t).toHaveTextContent('Готово')
    expect(t).toHaveTextContent('$ ls')
    expect(t).toHaveTextContent('ошибка')
    expect(t).toHaveTextContent('LIVE')
  })

  it('кнопка «Продолжить эту сессию» → onResumeSession с id', () => {
    const onResumeSession = vi.fn()
    renderObs({ activeProject: '/U/x/a', activeSession: 'sid-1', onResumeSession })
    fireEvent.click(screen.getByLabelText('Продолжить эту сессию'))
    expect(onResumeSession).toHaveBeenCalledWith('sid-1')
  })

  it('заголовок диалога и закрытие по ✕', () => {
    const onClose = vi.fn()
    renderObs({ onClose })
    expect(screen.getByRole('dialog', { name: 'Проводник Codex' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Закрыть'))
    expect(onClose).toHaveBeenCalled()
  })
})
