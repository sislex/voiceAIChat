import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CcObserver } from './CcObserver'
import type { CcProject, CcSession, CcItem } from '@shared/cc'

const projects: CcProject[] = [
  { slug: '-U-x-a', path: '/U/x/a', name: 'projA', sessionCount: 2, lastActivity: Date.now() }
]
const sessions: CcSession[] = [{ id: 's1', title: 'Первая сессия', updatedAt: Date.now(), sizeBytes: 10 }]
const transcript: CcItem[] = [
  { kind: 'user', text: 'Сделай фичу' },
  { kind: 'assistant', text: 'Готово **ок**' },
  { kind: 'tool_use', text: 'Bash: ls' },
  { kind: 'tool_result', text: 'ошибка', isError: true }
]

function renderObs(props: Partial<Parameters<typeof CcObserver>[0]> = {}): void {
  render(
    <CcObserver
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

describe('CcObserver', () => {
  it('рендерит проекты и зовёт onSelectProject', () => {
    const onSelectProject = vi.fn()
    renderObs({ onSelectProject })
    fireEvent.click(screen.getByText('projA'))
    expect(onSelectProject).toHaveBeenCalledWith('-U-x-a')
  })

  it('сессии выбранного проекта → onSelectSession', () => {
    const onSelectSession = vi.fn()
    renderObs({ activeProject: '-U-x-a', onSelectSession })
    fireEvent.click(screen.getByText('Первая сессия'))
    expect(onSelectSession).toHaveBeenCalledWith('-U-x-a', 's1')
  })

  it('транскрипт: сообщения + активность, live-индикатор при выбранной сессии', () => {
    renderObs({ activeProject: '-U-x-a', activeSession: 's1' })
    const t = screen.getByTestId('cc-transcript')
    expect(t).toHaveTextContent('Сделай фичу')
    expect(t).toHaveTextContent('Готово')
    expect(t).toHaveTextContent('Bash: ls')
    expect(t).toHaveTextContent('ошибка')
    expect(t).toHaveTextContent('LIVE')
  })

  it('кнопка «Продолжить эту сессию» → onResumeSession с проектом и id', () => {
    const onResumeSession = vi.fn()
    renderObs({ activeProject: '-U-x-a', activeSession: 's1', onResumeSession })
    fireEvent.click(screen.getByLabelText('Продолжить эту сессию'))
    expect(onResumeSession).toHaveBeenCalledWith('-U-x-a', 's1')
  })

  it('закрытие по ✕', () => {
    const onClose = vi.fn()
    renderObs({ onClose })
    fireEvent.click(screen.getByLabelText('Закрыть'))
    expect(onClose).toHaveBeenCalled()
  })
})
