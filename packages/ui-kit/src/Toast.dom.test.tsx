// Поведение тостов: автозакрытие и его пауза, очередь, кнопка действия,
// доступность (живая область, крестик с подписью, закрытие с клавиатуры) и
// отступ от композера на телефоне.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MOBILE_QUERY } from './mediaQuery'
import { TOAST_DURATION_MS, TOAST_VISIBLE_MAX, ToastProvider, useToast } from './Toast'

function Harness({ onRetry }: { onRetry?: () => void } = {}): JSX.Element {
  const toast = useToast()
  return (
    <div>
      <button onClick={() => toast.success('Скопировано')}>успех</button>
      <button onClick={() => toast.error('Сеть недоступна')}>ошибка</button>
      <button onClick={() => toast.info('Ход продолжается')}>факт</button>
      <button onClick={() => toast.error('Запрос упал', { action: { label: 'Повторить', onClick: () => onRetry?.() } })}>
        с повтором
      </button>
      <button onClick={() => [1, 2, 3, 4].forEach((n) => toast.info(`Сообщение ${n}`, { duration: 0 }))}>пачка</button>
    </div>
  )
}

const setup = (props: { onRetry?: () => void } = {}): void => {
  render(
    <ToastProvider>
      <Harness {...props} />
    </ToastProvider>
  )
}

function setMobile(mobile: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query === MOBILE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers()
    setMobile(false)
  })

  it('успех закрывается сам, ошибка ждёт крестика', () => {
    vi.useFakeTimers()
    setup()
    fireEvent.click(screen.getByText('успех'))
    fireEvent.click(screen.getByText('ошибка'))
    expect(screen.getByText('Скопировано')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS + 400))
    expect(screen.queryByText('Скопировано')).toBeNull()
    // Ошибку нужно успеть прочитать (и часто скопировать) — по времени не уходит.
    expect(screen.getByText('Сеть недоступна')).toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId('toast-error')).getByLabelText('Закрыть уведомление'))
    expect(screen.queryByText('Сеть недоступна')).toBeNull()
  })

  it('наведение мышью останавливает отсчёт', () => {
    vi.useFakeTimers()
    setup()
    fireEvent.click(screen.getByText('успех'))
    fireEvent.mouseEnter(screen.getByTestId('toasts'))
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 2))
    // Иначе тост с кнопкой исчезал бы из-под курсора ровно в момент клика.
    expect(screen.getByText('Скопировано')).toBeInTheDocument()

    fireEvent.mouseLeave(screen.getByTestId('toasts'))
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS + 400))
    expect(screen.queryByText('Скопировано')).toBeNull()
  })

  it('видимых не больше трёх, остальные ждут очереди', () => {
    setup()
    fireEvent.click(screen.getByText('пачка'))
    expect(screen.getAllByTestId('toast-info')).toHaveLength(TOAST_VISIBLE_MAX)
    expect(screen.queryByText('Сообщение 4')).toBeNull()

    fireEvent.click(within(screen.getByText('Сообщение 1').closest('.vc-toast')!).getByLabelText('Закрыть уведомление'))
    expect(screen.getByText('Сообщение 4')).toBeInTheDocument()
  })

  it('кнопка действия вызывает обработчик и убирает тост', () => {
    const onRetry = vi.fn()
    setup({ onRetry })
    fireEvent.click(screen.getByText('с повтором'))
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Запрос упал')).toBeNull()
  })

  it('доступен скринридеру: живая область, ошибка — assertive, крестик подписан', () => {
    setup()
    const region = screen.getByTestId('toasts')
    expect(region).toHaveAttribute('aria-live', 'polite')

    fireEvent.click(screen.getByText('ошибка'))
    const error = screen.getByTestId('toast-error')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveAttribute('aria-live', 'assertive')

    fireEvent.click(screen.getByText('факт'))
    expect(screen.getByTestId('toast-info')).toHaveAttribute('role', 'status')

    // Кнопке без подписи нужны оба атрибута: aria-label читает скринридер,
    // title показывает браузер.
    const close = within(error).getByLabelText('Закрыть уведомление')
    expect(close).toHaveAttribute('title', 'Закрыть уведомление')
  })

  it('закрывается с клавиатуры', () => {
    setup()
    fireEvent.click(screen.getByText('ошибка'))
    const error = screen.getByTestId('toast-error')
    const close = within(error).getByLabelText('Закрыть уведомление')
    close.focus()
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByText('Сеть недоступна')).toBeNull()
  })

  it('на телефоне стоит над композером, а не поверх него', () => {
    setMobile(true)
    const voicebar = document.createElement('div')
    voicebar.className = 'voicebar'
    Object.defineProperty(voicebar, 'offsetHeight', { value: 120 })
    document.body.appendChild(voicebar)

    render(
      <ToastProvider avoidSelector=".voicebar">
        <Harness />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('успех'))
    const region = screen.getByTestId('toasts')
    expect(region.className).toContain('vc-toasts--phone')
    // 120px композера + 12px зазора; calc jsdom сворачивает в одно значение.
    expect(region.style.bottom).toMatch(/132px/)
    voicebar.remove()
  })
  it('на телефоне публикует высоту стека, чтобы страница отодвинула нижние кнопки', () => {
    setMobile(true)
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )
    const root = document.documentElement
    expect(root.style.getPropertyValue('--vc-toast-inset')).toBe('')

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 64 })
    fireEvent.click(screen.getByText('успех'))
    // 64px стека + 12px зазора: на канбане этот отступ уводит «+ Создать»
    // из-под тоста, иначе тост перехватывает нажатие.
    expect(root.style.getPropertyValue('--vc-toast-inset')).toBe('76px')

    fireEvent.click(screen.getByTestId('toast-success').querySelector('.vc-toast-close')!)
    expect(root.style.getPropertyValue('--vc-toast-inset')).toBe('')
  })

  it('на десктопе безопасную зону не занимает: стек стоит в углу', () => {
    setMobile(false)
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>
    )
    fireEvent.click(screen.getByText('успех'))
    expect(document.documentElement.style.getPropertyValue('--vc-toast-inset')).toBe('')
  })
})
