import { useRef, useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from './Dialog'
import { DIALOG_Z_BASE, DIALOG_Z_STEP, dialogStackDepth } from './useDialogStack'
import { MOBILE_QUERY } from './mediaQuery'

/** Ширина экрана: Dialog переключается в полный экран по matchMedia (дефолт — десктоп). */
function setPhone(phone: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: phone && query === MOBILE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}
afterEach(() => setPhone(false))

/** Кнопка-открывашка рядом с окном: без неё не проверить возврат фокуса. */
function Harness({
  children,
  ...rest
}: Partial<Parameters<typeof Dialog>[0]> & { children?: React.ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Открыть</button>
      {open && (
        <Dialog title="Окно" testId="dlg" onClose={() => setOpen(false)} {...rest}>
          {children ?? (
            <div className="body">
              <button>Первая</button>
              <button>Вторая</button>
            </div>
          )}
        </Dialog>
      )}
    </>
  )
}

describe('Dialog — семантика и портал', () => {
  it('рендерится в document.body с dialog-семантикой и именем из заголовка', () => {
    const { container } = render(
      <Dialog title="Настройки" onClose={vi.fn()}>
        <p>тело</p>
      </Dialog>
    )
    // Портал: содержимое окна не остаётся в дереве вызывающего компонента.
    expect(container.textContent).toBe('')
    const dialog = screen.getByRole('dialog', { name: 'Настройки' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(screen.getByText('тело')).toBeInTheDocument()
  })

  it('ariaLabel переопределяет имя, когда видимый заголовок длиннее', () => {
    render(
      <Dialog title="Добро пожаловать в Голос·Чат" ariaLabel="Добро пожаловать">
        <p>тело</p>
      </Dialog>
    )
    expect(screen.getByRole('dialog', { name: 'Добро пожаловать' })).toBeInTheDocument()
  })

  it('слоты actions и footer рисуются в шапке и подвале', () => {
    render(
      <Dialog title="Окно" onClose={vi.fn()} actions={<button>Действие</button>} footer={<button>Сохранить</button>}>
        <p>тело</p>
      </Dialog>
    )
    const head = screen.getByRole('heading', { name: 'Окно' }).parentElement as HTMLElement
    expect(within(head).getByText('Действие')).toBeInTheDocument()
    expect(within(head).getByLabelText('Закрыть')).toBeInTheDocument()
    expect(screen.getByText('Сохранить')).toBeInTheDocument()
  })

  it('showClose=false убирает крестик (у мастера свои кнопки внизу)', () => {
    render(
      <Dialog title="Окно" onClose={vi.fn()} showClose={false}>
        <p>тело</p>
      </Dialog>
    )
    expect(screen.queryByLabelText('Закрыть')).toBeNull()
  })
})

describe('Dialog — закрытие', () => {
  it('Esc закрывает', async () => {
    const onClose = vi.fn()
    render(
      <Dialog title="Окно" onClose={onClose}>
        <p>тело</p>
      </Dialog>
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('клик по фону закрывает, клик внутри окна — нет', async () => {
    const onClose = vi.fn()
    render(
      <Dialog title="Окно" testId="dlg" onClose={onClose}>
        <p>тело</p>
      </Dialog>
    )
    await userEvent.click(screen.getByText('тело'))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('dlg'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('выделение текста, доведённое до фона, окно не закрывает', () => {
    const onClose = vi.fn()
    render(
      <Dialog title="Окно" testId="dlg" onClose={onClose}>
        <p>тело</p>
      </Dialog>
    )
    // Нажатие началось внутри окна, click всплыл до оверлея — это не клик по фону.
    fireEvent.mouseDown(screen.getByText('тело'))
    fireEvent.click(screen.getByTestId('dlg'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closeOnOverlay=false оставляет форму открытой (несохранённые данные)', async () => {
    const onClose = vi.fn()
    render(
      <Dialog title="Окно" testId="dlg" onClose={onClose} closeOnOverlay={false}>
        <p>тело</p>
      </Dialog>
    )
    await userEvent.click(screen.getByTestId('dlg'))
    expect(onClose).not.toHaveBeenCalled()
    // Esc при этом работает.
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('onEscape перехватывает и Esc, и крестик, и фон (подтверждение закрытия)', async () => {
    const onClose = vi.fn()
    const onEscape = vi.fn()
    render(
      <Dialog title="Окно" testId="dlg" onClose={onClose} onEscape={onEscape}>
        <p>тело</p>
      </Dialog>
    )
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByLabelText('Закрыть'))
    await userEvent.click(screen.getByTestId('dlg'))
    expect(onEscape).toHaveBeenCalledTimes(3)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Dialog — фокус', () => {
  it('фокус уходит на первый интерактивный элемент и возвращается на открывашку', async () => {
    render(<Harness />)
    const opener = screen.getByText('Открыть')
    await userEvent.click(opener)
    expect(screen.getByText('Первая')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('initialFocusRef перебивает первый элемент', async () => {
    function WithRef(): JSX.Element {
      const field = useRef<HTMLInputElement>(null)
      return (
        <Dialog title="Окно" onClose={vi.fn()} initialFocusRef={field}>
          <button>Первая</button>
          <input aria-label="Поле" ref={field} />
        </Dialog>
      )
    }
    render(<WithRef />)
    expect(screen.getByLabelText('Поле')).toHaveFocus()
  })

  it('Tab не уводит фокус за пределы окна и ходит по кругу', async () => {
    render(
      <>
        <button>Снаружи</button>
        <Dialog title="Окно" onClose={vi.fn()} showClose={false}>
          <button>Первая</button>
          <button>Вторая</button>
        </Dialog>
      </>
    )
    expect(screen.getByText('Первая')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByText('Вторая')).toHaveFocus()
    // С последнего — снова на первый, а не на кнопку страницы.
    await userEvent.tab()
    expect(screen.getByText('Первая')).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByText('Вторая')).toHaveFocus()
  })
})

describe('Dialog — скролл фона', () => {
  it('блокируется при открытии и восстанавливается после закрытия последнего окна', async () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(<Harness />)
    await userEvent.click(screen.getByText('Открыть'))
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('auto')
    unmount()
    document.body.style.overflow = ''
  })
})

describe('Dialog — стек окон', () => {
  /** Вложенность: подтверждение из карточки. */
  function Nested(): JSX.Element {
    const [confirm, setConfirm] = useState(false)
    return (
      <Dialog title="Карточка" testId="outer" onClose={vi.fn()}>
        <button onClick={() => setConfirm(true)}>Удалить</button>
        {confirm && (
          <Dialog title="Подтверждение" testId="inner" onClose={() => setConfirm(false)}>
            <button>Да</button>
          </Dialog>
        )}
      </Dialog>
    )
  }

  it('вложенное окно выше по z-index, Esc закрывает только его', async () => {
    render(<Nested />)
    expect(dialogStackDepth()).toBe(1)
    await userEvent.click(screen.getByText('Удалить'))
    expect(dialogStackDepth()).toBe(2)

    const outer = screen.getByTestId('outer')
    const inner = screen.getByTestId('inner')
    expect(outer.style.zIndex).toBe(String(DIALOG_Z_BASE))
    expect(inner.style.zIndex).toBe(String(DIALOG_Z_BASE + DIALOG_Z_STEP))

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Подтверждение' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Карточка' })).toBeInTheDocument()
    // Скролл всё ещё заблокирован: осталось открытое окно.
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('скролл возвращается только после закрытия последнего окна', async () => {
    const { unmount } = render(<Nested />)
    await userEvent.click(screen.getByText('Удалить'))
    await userEvent.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
    expect(dialogStackDepth()).toBe(0)
  })
})

describe('Dialog — телефон', () => {
  it('на ширине < 720px окно полноэкранное', () => {
    setPhone(true)
    render(
      <Dialog title="Окно" testId="dlg" onClose={vi.fn()}>
        <p>тело</p>
      </Dialog>
    )
    expect(screen.getByTestId('dlg').className).toContain('vc-dialog-overlay--phone')
    expect(screen.getByRole('dialog').className).toContain('vc-dialog--phone')
  })

  it('на десктопе размер задаётся пропом size', () => {
    render(
      <Dialog title="Окно" size="lg" onClose={vi.fn()}>
        <p>тело</p>
      </Dialog>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('vc-dialog--lg')
    expect(dialog.className).not.toContain('vc-dialog--phone')
  })
})
