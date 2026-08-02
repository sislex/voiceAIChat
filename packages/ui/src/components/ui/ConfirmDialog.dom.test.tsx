// Подтверждение: фокус на безопасной кнопке, danger-вариант, режим requireText
// для необратимого и обещание useConfirm, которое разрешается ответом.

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'
import { ConfirmProvider, useConfirm } from './useConfirm'

describe('ConfirmDialog', () => {
  it('фокус — на безопасной кнопке, подтверждение и отмена возвращают ответ', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog title="Удалить «Задача A»?" variant="danger" confirmLabel="Удалить" onConfirm={onConfirm} onCancel={onCancel} />)

    const dialog = screen.getByTestId('confirm-dialog')
    // Enter сразу после открытия не должен ничего удалять.
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toHaveFocus()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('показывает пояснение и закрывается по Esc как отмена', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog title="Полный доступ" message="Агент сможет выполнять команды." onConfirm={vi.fn()} onCancel={onCancel} />)
    expect(screen.getByText('Агент сможет выполнять команды.')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('requireText включает подтверждение только после ввода названия', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        title="Удалить колонку «Готово» со всеми задачами?"
        variant="danger"
        confirmLabel="Удалить колонку"
        requireText="Готово"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    )
    const dialog = screen.getByTestId('confirm-dialog')
    const input = within(dialog).getByRole('textbox')
    // В режиме requireText фокус на поле: с него начинается работа, и он безопасен.
    expect(input).toHaveFocus()
    const ok = within(dialog).getByRole('button', { name: 'Удалить колонку' })
    expect(ok).toBeDisabled()

    fireEvent.change(input, { target: { value: 'Гото' } })
    expect(ok).toBeDisabled()
    // Регистр и пробелы по краям не считаем: это защита от «нажал не думая».
    fireEvent.change(input, { target: { value: ' готово ' } })
    expect(ok).toBeEnabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('useConfirm', () => {
  function Screen({ onResult }: { onResult: (ok: boolean) => void }): JSX.Element {
    const confirm = useConfirm()
    return (
      <button
        onClick={() => void confirm({ title: 'Удалить «Задача A»?', confirmLabel: 'Удалить' }).then(onResult)}
      >
        Удалить задачу
      </button>
    )
  }

  const setup = (onResult: (ok: boolean) => void): void => {
    render(
      <ConfirmProvider>
        <Screen onResult={onResult} />
      </ConfirmProvider>
    )
  }

  it('разрешает промис true и снимает окно', async () => {
    const onResult = vi.fn()
    setup(onResult)
    fireEvent.click(screen.getByText('Удалить задачу'))
    const dialog = await screen.findByTestId('confirm-dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
    expect(screen.queryByTestId('confirm-dialog')).toBeNull()
  })

  it('отмена разрешает промис false', async () => {
    const onResult = vi.fn()
    setup(onResult)
    fireEvent.click(screen.getByText('Удалить задачу'))
    const dialog = await screen.findByTestId('confirm-dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })
})
