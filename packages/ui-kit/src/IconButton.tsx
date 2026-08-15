// Кнопка без видимой подписи: крестик окна, ⋯-меню карточки, стрелки «вверх/вниз»
// в списках. Тот же .vc-btn, что у Button, только квадратный и без текста.
//
// Правило packages/ui/AGENTS.md: у такой кнопки обязаны быть и aria-label (для
// скринридера), и title (тултип мышью — браузер aria-label не показывает).
// Поэтому оба поля здесь обязательны на уровне типов: забыть нельзя, сборка
// падает, а не тихо выпускает кнопку-загадку.

import { forwardRef, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

export interface IconButtonProps
  extends Omit<ButtonProps, 'aria-label' | 'title' | 'children' | 'iconLeft' | 'iconRight' | 'fullWidth'> {
  /** Имя действия для скринридера. Обязательно. */
  'aria-label': string
  /** Тултип мышью. Обязательно; обычно тот же текст, что в aria-label. */
  title: string
  /** Иконка: символ или SVG. Видимой подписи у такой кнопки нет. */
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, variant = 'ghost', ...rest },
  ref
): JSX.Element {
  // Иконка уходит в iconLeft, а не в children: так Button видит кнопку без
  // подписи и сам добавляет квадратную геометрию (.vc-btn--icon).
  return <Button {...rest} ref={ref} variant={variant} iconLeft={children} />
})

