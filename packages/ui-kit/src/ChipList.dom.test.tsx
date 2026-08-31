import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChipList } from './ChipList'

const setup = (items: string[] = ['payments']) => {
  const onAdd = vi.fn()
  const onRemove = vi.fn()
  render(<ChipList items={items} itemLabel="метку" placeholder="+ метка" onAdd={onAdd} onRemove={onRemove} />)
  return { onAdd, onRemove }
}

describe('ChipList', () => {
  it('Enter добавляет значение и очищает поле', async () => {
    const { onAdd } = setup()
    const input = screen.getByLabelText('Новый метку')
    await userEvent.type(input, 'search{Enter}')
    expect(onAdd).toHaveBeenCalledWith('search')
    expect(input).toHaveValue('')
  })

  it('уход из поля сохраняет так же, как Enter', async () => {
    const { onAdd } = setup()
    await userEvent.type(screen.getByLabelText('Новый метку'), 'frontend')
    await userEvent.tab()
    expect(onAdd).toHaveBeenCalledWith('frontend')
  })

  it('пустое и повторное значение до вызывающей стороны не доходят', async () => {
    const { onAdd } = setup(['payments'])
    const input = screen.getByLabelText('Новый метку')
    await userEvent.type(input, '   {Enter}')
    await userEvent.type(input, 'payments{Enter}')
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('у крестика чипа есть и подпись, и тултип — иконка без имени бесполезна', async () => {
    const { onRemove } = setup()
    const remove = screen.getByRole('button', { name: 'Убрать метку payments' })
    expect(remove).toHaveAttribute('title', 'Убрать метку')
    await userEvent.click(remove)
    expect(onRemove).toHaveBeenCalledWith('payments')
  })
})
