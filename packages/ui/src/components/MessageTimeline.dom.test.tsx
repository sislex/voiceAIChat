import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageTimeline } from './MessageTimeline'
import type { ClaudeLogEntry } from '@shared/types'

describe('MessageTimeline', () => {
  it('чередует текст и действие по смещению at', () => {
    const activity: ClaudeLogEntry[] = [
      { kind: 'tool_use', summary: 'Bash: ls', detail: 'ls', raw: '{"x":1}', at: 3 }
    ]
    const { container } = render(
      <MessageTimeline text="Абв где" activity={activity} detailed={false} />
    )
    // Обёртка таймлайна и одна секция действия между кусками текста.
    expect(screen.getByTestId('message-timeline')).toBeTruthy()
    expect(screen.getByTestId('activity-section')).toBeTruthy()
    const txt = container.textContent ?? ''
    expect(txt).toContain('Абв')
    expect(txt).toContain('где')
    // Детали свёрнуты, пока не нажата «Подробнее».
    expect(screen.queryByTestId('activity-raw')).toBeNull()
  })

  it('detailed раскрывает детали и сырой stream-json inline', () => {
    const activity: ClaudeLogEntry[] = [
      { kind: 'tool_use', summary: 'Bash: ls', detail: 'ls -la', raw: '{"raw":true}', at: 2 }
    ]
    render(<MessageTimeline text="абвг" activity={activity} detailed />)
    const raw = screen.getByTestId('activity-raw')
    expect(raw.textContent).toContain('{"raw":true}')
    expect(raw.textContent).toContain('ls -la')
  })

  it('несколько действий идут в хронологическом порядке (по at)', () => {
    const activity: ClaudeLogEntry[] = [
      { kind: 'tool_use', summary: 'Второе', raw: '{}', at: 5 },
      { kind: 'tool_use', summary: 'Первое', raw: '{}', at: 2 }
    ]
    render(<MessageTimeline text="0123456789" activity={activity} detailed={false} />)
    const secs = screen.getAllByTestId('activity-section')
    expect(secs).toHaveLength(2)
    // Порядок в DOM — по возрастанию смещения, а не по порядку в массиве.
    expect(secs[0].textContent).toContain('Первое')
    expect(secs[1].textContent).toContain('Второе')
  })

  it('старое сообщение без at — fallback к виду «действия над текстом»', () => {
    const activity: ClaudeLogEntry[] = [{ kind: 'tool_use', summary: 'Bash: ls', raw: '{}' }]
    const { container } = render(
      <MessageTimeline text="Текст ответа" activity={activity} detailed={false} />
    )
    expect(screen.getByTestId('message-activity')).toBeTruthy()
    expect(screen.queryByTestId('message-timeline')).toBeNull()
    expect(container.textContent).toContain('Текст ответа')
  })

  it('нет действий — только текст, без обёрток активности', () => {
    const { container } = render(<MessageTimeline text="Просто ответ" activity={[]} detailed={false} />)
    expect(screen.queryByTestId('message-timeline')).toBeNull()
    expect(screen.queryByTestId('message-activity')).toBeNull()
    expect(container.textContent).toContain('Просто ответ')
  })
})
