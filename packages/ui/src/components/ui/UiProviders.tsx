// Провайдеры примитивов интерфейса: тосты и подтверждения. Один компонент,
// потому что нужны они всегда вместе — и в корне App, и в тестах экранов, и в
// сториз (декоратор .storybook/preview.tsx).

import type { ReactNode } from 'react'
import { ToastProvider } from './Toast'
import { ConfirmProvider } from './useConfirm'

export interface UiProvidersProps {
  children: ReactNode
  /** Элемент у нижней кромки, который тостам нельзя перекрывать (см. ToastProvider). */
  avoidSelector?: string
}

export function UiProviders({ children, avoidSelector }: UiProvidersProps): JSX.Element {
  return (
    <ToastProvider {...(avoidSelector ? { avoidSelector } : {})}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  )
}
