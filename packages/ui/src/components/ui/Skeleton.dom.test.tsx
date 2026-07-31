import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RefreshIndicator, Skeleton } from './Skeleton'

describe('Skeleton', () => {
  it('line берёт ширину и высоту от экрана — геометрия совпадает с контентом', () => {
    render(<Skeleton variant="line" width="60%" height={12} />)
    const bone = screen.getByTestId('skeleton')
    expect(bone).toHaveClass('vc-skel', 'vc-skel--line')
    expect(bone.style.width).toBe('60%')
    expect(bone.style.height).toBe('12px')
  })

  it('block — прямоугольник заданной высоты', () => {
    render(<Skeleton variant="block" height={54} />)
    expect(screen.getByTestId('skeleton')).toHaveClass('vc-skel--block')
    expect(screen.getByTestId('skeleton').style.height).toBe('54px')
  })

  it('card — карточка со строками внутри', () => {
    render(<Skeleton variant="card" height={72} lines={2} />)
    const card = screen.getByTestId('skeleton')
    expect(card).toHaveClass('vc-skel-card')
    expect(card.style.height).toBe('72px')
    expect(card.querySelectorAll('.vc-skel--line')).toHaveLength(2)
  })

  it('list рисует n элементов и передаёт им класс и высоту', () => {
    render(<Skeleton variant="list" item="block" count={4} height={30} itemClassName="row-skel" />)
    const bones = screen.getAllByTestId('skeleton')
    expect(bones).toHaveLength(4)
    expect(bones[0]).toHaveClass('row-skel')
    expect(bones[0].style.height).toBe('30px')
  })

  it('косточки скрыты от скринридера — озвучивать нечего', () => {
    render(<Skeleton variant="line" />)
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('RefreshIndicator', () => {
  it('живая область со своей подписью — повторная загрузка не прячет данные', () => {
    render(<RefreshIndicator label="Обновляем список…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Обновляем список…')
  })
})
