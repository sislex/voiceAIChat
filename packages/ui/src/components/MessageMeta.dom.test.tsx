import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageMeta } from './MessageMeta'
import { makeTurnMeta } from '../test/fixtures'
import '../styles/app.css'

// Мета хода — общая фикстура: те же значения показывают сториз Chat/MessageMeta.
const META = makeTurnMeta()

describe('MessageMeta', () => {
  it('тултип с краткой сводкой появляется по наведению', async () => {
    const user = userEvent.setup()
    render(<MessageMeta meta={META} />)
    expect(screen.queryByTestId('meta-tip')).not.toBeInTheDocument()
    await user.hover(screen.getByLabelText('Сведения об ответе').parentElement as HTMLElement)
    const tip = screen.getByTestId('meta-tip')
    expect(tip.textContent).toContain('sonnet')
    expect(tip.textContent).toContain('1.5k → 320')
    expect(tip.textContent).toContain('3.4 с')
  })

  it('«Подробнее» открывает панель с промптом, инструментами и навыками', async () => {
    const user = userEvent.setup()
    render(<MessageMeta meta={META} />)
    await user.click(screen.getByLabelText('Сведения об ответе'))
    expect(screen.getByTestId('meta-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('meta-prompt').textContent).toBe('Как дела?')
    // Инструменты и навыки перечислены чипсами.
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('review')).toBeInTheDocument()
    expect(screen.getByText('remote')).toBeInTheDocument()
    // Явно помечаем недоступность внутреннего системного промпта.
    expect(screen.getByText(/не отдаётся наружу/)).toBeInTheDocument()
  })

  it('«Подробнее» показывает весь контекст отправленных сообщений', async () => {
    const user = userEvent.setup()
    render(<MessageMeta meta={META} />)
    await user.click(screen.getByLabelText('Сведения об ответе'))
    const msgs = screen.getByTestId('meta-messages')
    expect(msgs.textContent).toContain('Первый вопрос')
    expect(msgs.textContent).toContain('Первый ответ')
    expect(msgs.textContent).toContain('Как дела?')
    // При resume честно помечаем, что история хранится в сессии CLI.
    expect(screen.getByText(/хранится в сессии CLI/)).toBeInTheDocument()
  })

  it('тултип показывает время ответа', async () => {
    const user = userEvent.setup()
    render(<MessageMeta meta={META} />)
    await user.hover(screen.getByLabelText('Сведения об ответе').parentElement as HTMLElement)
    const tip = screen.getByTestId('meta-tip')
    expect(tip.textContent).toContain('Время ответа')
    expect(tip.textContent).toContain('3.4 с')
  })

  it('закрывается по кнопке ✕', async () => {
    const user = userEvent.setup()
    render(<MessageMeta meta={META} />)
    await user.click(screen.getByLabelText('Сведения об ответе'))
    await user.click(screen.getByLabelText('Закрыть'))
    expect(screen.queryByTestId('meta-overlay')).not.toBeInTheDocument()
  })
})
