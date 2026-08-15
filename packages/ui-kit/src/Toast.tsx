// Тосты — короткие сообщения о результате действия: «Скопировано», «Настройки
// сохранены», текст упавшего запроса. Нужны потому, что у половины операций
// результат не виден: удалась она или нет, пользователь понимал только по тому,
// изменился ли экран.
//
// Правила стека (почему так, а не «показать всё»):
//   • успех/факт закрываются сами через TOAST_DURATION_MS, ошибка — только
//     крестиком: её нужно успеть прочитать, а часто и скопировать;
//   • наведение мышью останавливает отсчёт — иначе тост с кнопкой «Повторить»
//     исчезает под курсором ровно в момент клика;
//   • видимых тостов не больше TOAST_VISIBLE_MAX, остальные ждут очереди:
//     пачка ошибок от одного сломанного запроса иначе застилает пол-экрана.
//
// Доступность: контейнер — живая область aria-live="polite", ошибки повышают
// её до assertive на себе (role="alert"), чтобы их прочитали сразу. Контейнер
// смонтирован всегда: живая область должна существовать до появления текста,
// иначе скринридер молчит. Клики он не перехватывает (pointer-events: none).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { MOBILE_QUERY, useMediaQuery } from './mediaQuery'

export type ToastKind = 'success' | 'error' | 'info'

/** Кнопка в тосте: «Повторить» у неудавшегося запроса, «Отменить» и т.п. */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  action?: ToastAction
  /** Сколько держать на экране, мс. 0 — до крестика (так ведут себя ошибки). */
  duration?: number
}

export interface ToastApi {
  success: (text: string, options?: ToastOptions) => string
  error: (text: string, options?: ToastOptions) => string
  info: (text: string, options?: ToastOptions) => string
  dismiss: (id: string) => void
}

/** Автозакрытие обычного тоста. */
export const TOAST_DURATION_MS = 4000
/** Сколько тостов видно одновременно; остальные ждут в очереди. */
export const TOAST_VISIBLE_MAX = 3
/** Шаг обратного отсчёта: один таймер на весь стек, пауза — просто его остановка. */
const TICK_MS = 200
const CLOSE_LABEL = 'Закрыть уведомление'
const ICON: Record<ToastKind, string> = { success: '✓', error: '!', info: 'i' }

interface ToastItem {
  id: string
  kind: ToastKind
  text: string
  action?: ToastAction
  /** 0 — по времени не закрывать. */
  duration: number
}

const ToastContext = createContext<ToastApi | null>(null)

let seq = 0
const nextId = (): string => `toast-${++seq}`

export interface ToastProviderProps {
  children: ReactNode
  /**
   * Селектор элемента у нижней кромки, который тостам нельзя перекрывать
   * (композер VoiceBar на телефоне: стек стоит над ним, а не поверх). Элемента
   * на странице нет — отступа тоже нет, поэтому на страницах-утилитах тосты
   * прижаты к низу.
   */
  avoidSelector?: string
}

export function ToastProvider({ children, avoidSelector }: ToastProviderProps): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  const [paused, setPaused] = useState(false)
  // Остаток времени живёт в ref: перезапуск таймера (новый тост, пауза) не
  // должен обнулять отсчёт уже показанным.
  const left = useRef(new Map<string, number>())
  const phone = useMediaQuery(MOBILE_QUERY)

  const dismiss = useCallback((id: string): void => {
    left.current.delete(id)
    setItems((all) => all.filter((item) => item.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, text: string, options?: ToastOptions): string => {
    const id = nextId()
    const duration = options?.duration ?? (kind === 'error' ? 0 : TOAST_DURATION_MS)
    setItems((all) => [...all, { id, kind, text, duration, ...(options?.action ? { action: options.action } : {}) }])
    return id
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (text, options) => push('success', text, options),
      error: (text, options) => push('error', text, options),
      info: (text, options) => push('info', text, options),
      dismiss
    }),
    [push, dismiss]
  )

  const visible = items.slice(0, TOAST_VISIBLE_MAX)

  // Обратный отсчёт: один интервал на весь стек. Считаем только видимые — тост
  // из очереди начинает жить, когда его показали, а не когда поставили в стек.
  useEffect(() => {
    const auto = visible.filter((item) => item.duration > 0)
    if (paused || auto.length === 0) return
    const timer = setInterval(() => {
      const expired: string[] = []
      for (const item of auto) {
        const rest = (left.current.get(item.id) ?? item.duration) - TICK_MS
        left.current.set(item.id, rest)
        if (rest <= 0) expired.push(item.id)
      }
      if (expired.length === 0) return
      expired.forEach((id) => left.current.delete(id))
      setItems((all) => all.filter((item) => !expired.includes(item.id)))
    }, TICK_MS)
    return () => clearInterval(timer)
    // items → новый список видимых; paused → остановка/возобновление отсчёта.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, paused])

  // Отступ от нижней кромки: высота композера, если он на странице есть.
  // Меряем по факту, а не константой: композер растёт вместе с текстом и
  // вложениями, а на страницах-утилитах его вовсе нет.
  const [avoidHeight, setAvoidHeight] = useState(0)
  useLayoutEffect(() => {
    if (!avoidSelector || visible.length === 0) return
    const node = document.querySelector<HTMLElement>(avoidSelector)
    const measure = (): void => setAvoidHeight(node?.offsetHeight ?? 0)
    measure()
    window.addEventListener('resize', measure)
    const observer = node && typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(node as HTMLElement)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avoidSelector, visible.length])

  const viewport = (
    <div
      className={`vc-toasts${phone ? ' vc-toasts--phone' : ''}`}
      // Отступ нужен только на телефоне: на десктопе стек стоит в углу, где
      // композера нет.
      style={phone && avoidHeight > 0 ? { bottom: `calc(${avoidHeight}px + 12px)` } : undefined}
      data-testid="toasts"
      aria-live="polite"
      aria-atomic="false"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {visible.map((item) => (
        <div
          key={item.id}
          className={`vc-toast vc-toast--${item.kind}`}
          data-testid={`toast-${item.kind}`}
          {...(item.kind === 'error' ? { role: 'alert', 'aria-live': 'assertive' as const } : { role: 'status' })}
          // Esc закрывает тост, когда фокус внутри него. Обработчик локальный:
          // глобальный перебивал бы Esc окон и хоткеи приложения.
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            dismiss(item.id)
          }}
        >
          <span className="vc-toast-icon" aria-hidden="true">
            {ICON[item.kind]}
          </span>
          <span className="vc-toast-text">{item.text}</span>
          {item.action && (
            <button
              className="vc-toast-action"
              onClick={() => {
                item.action?.onClick()
                dismiss(item.id)
              }}
            >
              {item.action.label}
            </button>
          )}
          <button className="vc-toast-close" aria-label={CLOSE_LABEL} title={CLOSE_LABEL} onClick={() => dismiss(item.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' ? createPortal(viewport, document.body) : null}
    </ToastContext.Provider>
  )
}

/** Доступ к тостам. Требует ToastProvider — в приложении он стоит в корне App. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast: нет ToastProvider — оберните дерево в <ToastProvider>')
  return api
}
