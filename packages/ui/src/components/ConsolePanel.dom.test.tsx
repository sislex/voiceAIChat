import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConsolePanel } from './ConsolePanel'
import type { ClaudeLogEntry } from '@shared/types'

const entries: ClaudeLogEntry[] = [
  { kind: 'system', summary: 'model=opus · mode=default', raw: '{"type":"system"}' },
  { kind: 'tool_use', summary: 'Bash: ls -la', detail: 'ls -la', raw: '{"type":"assistant"}' }
]

describe('ConsolePanel', () => {
  it('рендерит записи лога с бейджами вида', () => {
    render(<ConsolePanel log={entries} open onToggle={() => {}} />)
    expect(screen.getAllByTestId('console-row')).toHaveLength(2)
    expect(screen.getByText('Bash: ls -la')).toBeTruthy()
  })

  it('клик по записи раскрывает сырой JSON и детали', () => {
    render(<ConsolePanel log={entries} open onToggle={() => {}} />)
    expect(screen.queryByTestId('console-raw')).toBeNull()
    fireEvent.click(screen.getByText('Bash: ls -la'))
    const raw = screen.getByTestId('console-raw')
    expect(raw.textContent).toContain('{"type":"assistant"}')
    expect(raw.textContent).toContain('ls -la') // detail
  })

  it('свёрнутая панель не показывает тело', () => {
    render(<ConsolePanel log={entries} open={false} onToggle={() => {}} />)
    expect(screen.queryByTestId('console-body')).toBeNull()
  })

  it('клик по заголовку зовёт onToggle', () => {
    const onToggle = vi.fn()
    render(<ConsolePanel log={[]} open onToggle={onToggle} />)
    fireEvent.click(screen.getByLabelText('Режим консоли'))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('пустой лог показывает заглушку', () => {
    render(<ConsolePanel log={[]} open onToggle={() => {}} />)
    expect(screen.getByText('Пока нет активности агента.')).toBeTruthy()
  })
})
