import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlaygroundToolbar } from './ComponentPlayground.js'

describe('PlaygroundToolbar', () => {
  it('resets a changed example and reports its state', () => {
    const onReset = vi.fn()
    render(<PlaygroundToolbar dirty theme="light" onReset={onReset} onToggleTheme={() => {}} />)

    expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить пример' }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('disables reset for pristine code and toggles the local theme', () => {
    const onToggleTheme = vi.fn()
    render(<PlaygroundToolbar dirty={false} theme="dark" onReset={() => {}} onToggleTheme={onToggleTheme} />)

    expect(screen.getByRole('button', { name: 'Сбросить пример' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Включить светлую тему песочницы' }))
    expect(onToggleTheme).toHaveBeenCalledOnce()
  })
})

