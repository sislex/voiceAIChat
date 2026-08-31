import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StepList } from './StepList'

describe('StepList', () => {
  it('шаги — упорядоченный список: порядок здесь часть смысла', () => {
    render(<StepList steps={[{ title: 'Первый' }, { title: 'Второй' }]} />)
    expect(screen.getByRole('list').tagName).toBe('OL')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('состояние читается словом, а не значком', () => {
    // «✓» скринридер прочитал бы как «галочка» — значок скрыт, рядом стоит подпись.
    render(<StepList steps={[{ title: 'Репозиторий синхронизирован', state: 'done' }]} />)
    const item = screen.getByRole('listitem')
    expect(item).toHaveTextContent('Выполнено')
    expect(item.querySelector('.vc-step__mark')).toHaveAttribute('aria-hidden', 'true')
  })

  it('у ожидающего шага в кружке его номер — видно, сколько впереди', () => {
    render(<StepList steps={[{ title: 'Есть', state: 'done' }, { title: 'Ждёт' }, { title: 'И этот' }]} />)
    const marks = [...screen.getByRole('list').querySelectorAll('.vc-step__mark')].map((n) => n.textContent)
    expect(marks).toEqual(['✓', '2', '3'])
  })

  it('каждое состояние даёт свой модификатор и data-state', () => {
    render(
      <StepList
        steps={[
          { title: 'a', state: 'done' },
          { title: 'b', state: 'running' },
          { title: 'c', state: 'failed' },
          { title: 'd', state: 'pending' }
        ]}
      />
    )
    const states = screen.getAllByRole('listitem').map((node) => node.getAttribute('data-state'))
    expect(states).toEqual(['done', 'running', 'failed', 'pending'])
    expect(screen.getAllByRole('listitem')[1]).toHaveClass('vc-step--running')
  })

  it('подробность шага показывается под заголовком', () => {
    render(<StepList steps={[{ title: 'Реализация', detail: 'Изменено 6 файлов · +284 −31' }]} />)
    expect(screen.getByText('Изменено 6 файлов · +284 −31')).toBeInTheDocument()
  })
})
