import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageTimeline } from './MessageTimeline'
import type { ClaudeLogEntry } from '@shared/types'

describe('MessageTimeline', () => {
  it('minimal: только текст, без действий', () => {
    const activity: ClaudeLogEntry[] = [
      { kind: 'tool_use', summary: 'Bash: ls', raw: '{}', at: 3, ts: 1000 }
    ]
    render(<MessageTimeline text="Абв где" activity={activity} mode="minimal" />)
    expect(screen.queryByTestId('message-timeline')).toBeNull()
    expect(screen.queryByTestId('activity-section')).toBeNull()
    expect(screen.queryByTestId('activity-brief')).toBeNull()
    expect(screen.getByText(/Абв где/)).toBeTruthy()
  })

  it('detailed: чередует текст и действие по смещению at', () => {
    const activity: ClaudeLogEntry[] = [
      { kind: 'tool_use', summary: 'Bash: ls', detail: 'ls', raw: '{"x":1}', at: 3, ts: 1000 }
    ]
    const { container } = render(
      <MessageTimeline text="Абв где" activity={activity} mode="detailed" />
    )
    expect(screen.getByTestId('message-timeline')).toBeTruthy()
    expect(screen.getByTestId('activity-section')).toBeTruthy()
    const txt = container.textContent ?? ''
    expect(txt).toContain('Абв')
    expect(txt).toContain('где')
    // Детали свёрнуты, пока не кликнули по секции.
    expect(screen.queryByTestId('activity-raw')).toBeNull()
    fireEvent.click(screen.getByText('Bash: ls'))
    expect(screen.getByTestId('activity-raw').textContent).toContain('{"x":1}')
  })

  it('detailed: несколько действий в хронологическом порядке (по at)', () => {
    const activity: ClaudeLogEntry[] = [
      { kind: 'tool_use', summary: 'Второе', raw: '{}', at: 5, ts: 2000 },
      { kind: 'tool_use', summary: 'Первое', raw: '{}', at: 2, ts: 1000 }
    ]
    render(<MessageTimeline text="0123456789" activity={activity} mode="detailed" />)
    const secs = screen.getAllByTestId('activity-section')
    expect(secs).toHaveLength(2)
    expect(secs[0].textContent).toContain('Первое')
    expect(secs[1].textContent).toContain('Второе')
  })

  it('brief: сводка секции с количеством и длительностью', () => {
    const activity: ClaudeLogEntry[] = [
      { kind: 'tool_use', summary: 'Bash: ls', raw: '{}', at: 3, ts: 1000 },
      { kind: 'tool_result', summary: '✓ результат', raw: '{}', at: 3, ts: 5000 }
    ]
    // endMs — конец хода: секция шла 1000..9000 = 8с, последнее 5000..9000 = 4с.
    render(<MessageTimeline text="Абв где" activity={activity} mode="brief" endMs={9000} />)
    const brief = screen.getByTestId('activity-brief')
    expect(screen.queryByTestId('activity-section')).toBeNull()
    expect(brief.textContent).toContain('2') // счётчик действий
    expect(brief.textContent).toContain('8с')
    expect(brief.textContent).toContain('последнее 4с')
  })

  it('старое сообщение без at — fallback (detailed → секции, minimal → текст)', () => {
    const activity: ClaudeLogEntry[] = [{ kind: 'tool_use', summary: 'Bash: ls', raw: '{}' }]
    const { rerender, container } = render(
      <MessageTimeline text="Текст ответа" activity={activity} mode="detailed" />
    )
    expect(screen.getByTestId('message-activity')).toBeTruthy()
    expect(screen.getByTestId('activity-section')).toBeTruthy()
    rerender(<MessageTimeline text="Текст ответа" activity={activity} mode="minimal" />)
    expect(screen.queryByTestId('message-activity')).toBeNull()
    expect(container.textContent).toContain('Текст ответа')
  })

  it('нет действий — только текст', () => {
    const { container } = render(<MessageTimeline text="Просто ответ" activity={[]} mode="brief" />)
    expect(screen.queryByTestId('message-timeline')).toBeNull()
    expect(screen.queryByTestId('message-activity')).toBeNull()
    expect(container.textContent).toContain('Просто ответ')
  })
})
