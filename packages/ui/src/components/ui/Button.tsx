// Единая кнопка приложения.
//
// До неё в app.css жило около тридцати независимых *btn-классов (.newbtn,
// .delbtn, .ci-btn, .mst-btn, .footbtn…), каждый со своими падингами, радиусом и
// hover. Следствия: одинаковые по смыслу действия («Удалить», «Отмена»,
// «Сохранить») выглядели по-разному на канбане, в CI-панели и в настройках;
// часть классов не была переопределена под тёмную тему; фокус-кольцо для
// клавиатуры было не у всех. Теперь вид задают четыре варианта и два размера, а
// стили — один блок .vc-btn в app.css, целиком на токенах.
//
// Эталон взят с текущей основной кнопки: акцентная заливка --accent.
//
// Кнопка без видимой подписи — не этот компонент, а IconButton рядом: там типы
// требуют и aria-label, и title (правило packages/ui/AGENTS.md).

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

/**
 * primary — главное действие экрана (одно на форму), secondary — обычное
 * действие в рамке, ghost — действие без рамки (иконки в шапках, ряды в подвале
 * сайдбара), danger — удаление и откат.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

/** sm — плотные ряды (карточки, шапки, тулбары), md — формы и подвалы окон. */
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Идёт запрос: спиннер вместо iconLeft, aria-busy и блокировка от двойной отправки. */
  loading?: boolean
  /** Растянуть на всю ширину контейнера (кнопка в столбце формы). */
  fullWidth?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
  children?: ReactNode
}

/** Спиннер на currentColor — в любом варианте и любой теме сам подхватывает цвет текста. */
function Spinner(): JSX.Element {
  return <span className="vc-btn__spinner" aria-hidden="true" />
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    fullWidth = false,
    iconLeft,
    iconRight,
    children,
    className,
    disabled,
    // По умолчанию button, а не submit: кнопка внутри формы не должна отправлять
    // её неожиданно. Экрану с настоящим submit достаточно передать type.
    type = 'button',
    ...rest
  },
  ref
): JSX.Element {
  const busy = loading === true
  const cls = [
    'vc-btn',
    `vc-btn--${variant}`,
    `vc-btn--${size}`,
    fullWidth && 'vc-btn--block',
    // Кнопка без подписи (IconButton) — квадратная: падинги по кругу, а не по бокам.
    children == null || children === false || children === '' ? 'vc-btn--icon' : null,
    busy && 'is-loading',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cls}
      // Защита от двойной отправки: пока идёт запрос, клик не проходит.
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <Spinner /> : iconLeft != null && <span className="vc-btn__ico">{iconLeft}</span>}
      {children}
      {!busy && iconRight != null && <span className="vc-btn__ico">{iconRight}</span>}
    </button>
  )
})
