import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'
import { IconButton } from './IconButton'

describe('Button', () => {
  it('по умолчанию не отправляет форму', () => {
    render(<Button>Сохранить</Button>)
    expect(screen.getByRole('button', { name: 'Сохранить' })).toHaveAttribute('type', 'button')
  })

  it('loading блокирует кнопку и помечает её aria-busy — двойной отправки не будет', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Сохранить
      </Button>
    )
    const button = screen.getByRole('button', { name: /Сохранить/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('в loading иконка уступает место спиннеру', () => {
    const { rerender } = render(
      <Button iconLeft={<i data-testid="ico" />}>Отправить</Button>
    )
    expect(screen.getByTestId('ico')).toBeInTheDocument()
    rerender(
      <Button loading iconLeft={<i data-testid="ico" />}>
        Отправить
      </Button>
    )
    expect(screen.queryByTestId('ico')).toBeNull()
  })

  it('вариант, размер и fullWidth — это модификаторы одного класса', () => {
    render(
      <Button variant="danger" size="sm" fullWidth>
        Удалить
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Удалить' })
    expect(button.className.split(' ')).toEqual(
      expect.arrayContaining(['vc-btn', 'vc-btn--danger', 'vc-btn--sm', 'vc-btn--block'])
    )
  })

  it('остальные пропы и ref доходят до элемента', () => {
    let node: HTMLButtonElement | null = null
    render(
      <Button ref={(el) => { node = el }} data-testid="probe" aria-pressed>
        Микрофон
      </Button>
    )
    expect(node).toBe(screen.getByTestId('probe'))
    expect(screen.getByTestId('probe')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('IconButton', () => {
  it('имя для скринридера и тултип мышью — оба', () => {
    render(
      <IconButton aria-label="Закрыть окно" title="Закрыть окно">
        ✕
      </IconButton>
    )
    const button = screen.getByRole('button', { name: 'Закрыть окно' })
    expect(button).toHaveAttribute('title', 'Закрыть окно')
    // Без видимой подписи — квадратная геометрия.
    expect(button.className).toContain('vc-btn--icon')
  })
})
