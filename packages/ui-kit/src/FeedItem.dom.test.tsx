import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeedItem, FeedLog } from './FeedItem'

describe('FeedItem', () => {
  it('раскрытие — нативное details: клавиатура и поиск по странице работают без нас', () => {
    const { container } = render(<FeedItem title="Реализация API поиска">детали</FeedItem>)
    const details = container.querySelector('details')
    expect(details).toHaveClass('vc-feed-item')
    expect(details).not.toHaveAttribute('open')
  })

  it('текущее событие открыто сразу', () => {
    const { container } = render(<FeedItem title="Идёт" defaultOpen>детали</FeedItem>)
    expect(container.querySelector('details')).toHaveAttribute('open')
  })

  it('тон превращается в модификатор точки', () => {
    const { container } = render(<FeedItem title="Успех" tone="success" />)
    expect(container.querySelector('.vc-feed-dot')).toHaveClass('vc-feed-dot--success')
  })

  it('нейтральный тон — приглушённая точка, шеврон скрыт от читалки', () => {
    const { container } = render(<FeedItem title="Запуск создан" />)
    expect(container.querySelector('.vc-feed-dot')).toHaveClass('vc-feed-dot--muted')
    expect(container.querySelector('.vc-feed-caret')).toHaveAttribute('aria-hidden', 'true')
  })

  it('мета уходит вправо отдельным элементом', () => {
    const { container } = render(<FeedItem title="Событие" meta="11:24" />)
    expect(container.querySelector('.vc-feed-status')).toHaveTextContent('11:24')
  })
})

describe('FeedLog', () => {
  it('прокручиваемый лог именован и достижим с клавиатуры', () => {
    render(<FeedLog>{'$ git checkout -b task/CHAT-248\n✓ workspace ready'}</FeedLog>)
    const log = screen.getByRole('group', { name: 'Лог' })
    expect(log).toHaveAttribute('tabindex', '0')
    expect(log.textContent).toContain('workspace ready')
  })

  it('имя области задаётся снаружи — логов на вкладке бывает несколько', () => {
    render(<FeedLog label="Лог подготовки">строка</FeedLog>)
    expect(screen.getByRole('group', { name: 'Лог подготовки' })).toBeInTheDocument()
  })
})
