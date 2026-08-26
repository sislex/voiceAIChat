import { describe, it, expect, vi } from 'vitest'
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
    render(<MessageMeta meta={META} messageId="a1" />)
    expect(screen.queryByTestId('meta-tip')).not.toBeInTheDocument()
    // Триггер — сам блок токенов: цифры хода видны прямо в кнопке.
    const trigger = screen.getByLabelText('Сведения об ответе')
    expect(trigger).toHaveAttribute('data-testid', 'message-tokens-a1')
    expect(trigger.textContent).toMatch(/↓|↑/)
    await user.hover(trigger)
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

describe('MessageMeta — разделы базы знаний', () => {
  const withKb = {
    ...META,
    request: {
      ...META.request!,
      kbContext: {
        confidence: 'high' as const,
        sections: [
          { documentId: 'protocol', title: 'Протокол', heading: 'WebSocket', sourcePath: 'docs/kb/protocol.md', anchor: 'websocket', chars: 620, estimatedTokens: 155, freshness: 'current' as const }
        ]
      }
    }
  }

  it('показывает символы и оценку токенов из БЗ с оговоркой про формулу', async () => {
    const user = userEvent.setup()
    render(<MessageMeta meta={withKb} />)
    await user.click(screen.getByLabelText('Сведения об ответе'))
    const body = screen.getByTestId('meta-overlay')
    expect(body).toHaveTextContent('Символы из БЗ')
    expect(body).toHaveTextContent('620')
    expect(body).toHaveTextContent('155 (оценка chars / 4)')
  })

  it('чипс раздела — ссылка на документ базы знаний', async () => {
    const user = userEvent.setup()
    const onOpenKbDocument = vi.fn()
    render(<MessageMeta meta={withKb} onOpenKbDocument={onOpenKbDocument} />)
    await user.click(screen.getByLabelText('Сведения об ответе'))
    await user.click(screen.getByTitle('Открыть «Протокол / WebSocket» в базе знаний'))
    expect(onOpenKbDocument).toHaveBeenCalledWith('protocol', 'websocket')
  })

  it('без обработчика чипсы остаются статическим текстом', async () => {
    const user = userEvent.setup()
    render(<MessageMeta meta={withKb} />)
    await user.click(screen.getByLabelText('Сведения об ответе'))
    expect(screen.queryByTitle('Открыть «Протокол / WebSocket» в базе знаний')).not.toBeInTheDocument()
    expect(screen.getByTestId('meta-overlay')).toHaveTextContent('Протокол / WebSocket')
  })
})
