import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorState } from './ErrorState'

describe('ErrorState', () => {
  it('ошибка озвучивается сразу: контейнер — role=alert', () => {
    render(<ErrorState message="Не удалось загрузить доску" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить доску')
  })

  it('техническая деталь спрятана под «Подробнее»', () => {
    render(<ErrorState message="Не удалось загрузить доску" detail="fetch failed: ECONNREFUSED" />)
    const details = screen.getByText('Подробнее').closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent('ECONNREFUSED')
  })

  it('«Повторить» есть только с обработчиком и зовёт его', async () => {
    const onRetry = vi.fn()
    const { unmount } = render(<ErrorState onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    unmount()
    render(<ErrorState />)
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull()
  })
})
