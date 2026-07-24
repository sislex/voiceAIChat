import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageActivity } from './MessageActivity'
import type { ClaudeLogEntry } from '@shared/types'

const activity: ClaudeLogEntry[] = [
  { kind: 'system', summary: 'model=opus · mode=default', raw: '{"type":"system"}' },
  { kind: 'tool_use', summary: 'Bash: ls -la', detail: 'ls -la', raw: '{"type":"assistant"}' },
  { kind: 'result', summary: 'Готово', raw: '{"type":"result"}' }
]

describe('MessageActivity', () => {
  it('простой вид: счётчик действий, без секций', () => {
    render(<MessageActivity activity={activity} detailed={false} />)
    expect(screen.getByTestId('activity-count').textContent).toContain('3 действия')
    expect(screen.queryByTestId('activity-sections')).toBeNull()
  })

  it('завершённый ход без активности — ничего не рендерит', () => {
    const { container } = render(<MessageActivity activity={[]} detailed={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('подробный вид: секции по каждому действию с меткой места', () => {
    render(<MessageActivity activity={activity} detailed execTarget="macbook" />)
    expect(screen.getAllByTestId('activity-section')).toHaveLength(3)
    expect(screen.getByText('Bash: ls -la')).toBeTruthy()
    // Команда выполнялась на выбранной машине.
    expect(screen.getByText('на машине «macbook»')).toBeTruthy()
  })

  it('клик по секции раскрывает сырой stream-json и детали', () => {
    render(<MessageActivity activity={activity} detailed />)
    expect(screen.queryByTestId('activity-raw')).toBeNull()
    fireEvent.click(screen.getByText('Bash: ls -la'))
    const raw = screen.getByTestId('activity-raw')
    expect(raw.textContent).toContain('{"type":"assistant"}')
    expect(raw.textContent).toContain('ls -la')
  })

  it('живой ход: показывает фразу статуса', () => {
    render(
      <MessageActivity
        activity={[{ kind: 'tool_use', summary: 'Bash: ls', raw: '{}' }]}
        detailed={false}
        live
        voice="thinking"
      />
    )
    expect(screen.getByText('Выполняю команду на сервере…')).toBeTruthy()
  })
})
