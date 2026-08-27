// Единственный примитив, оставшийся в этом каталоге: SidebarToggle — обёртка над IconButton из ui-kit
// с фиксированной подписью. Остальные примитивы (Button, Dialog, Toast, useConfirm…) живут в
// `@voicechat/ui-kit` — их копии здесь удалены (п.40), чтобы правка кнопки не расходилась на два места.
import { forwardRef } from 'react'
import { IconButton } from '@voicechat/ui-kit'

export interface SidebarToggleProps {
  expanded: boolean
  onToggle: () => void
  className?: string
}

/** Единый переключатель общего Sidebar для шапок чата и страниц проекта. */
export const SidebarToggle = forwardRef<HTMLButtonElement, SidebarToggleProps>(function SidebarToggle(
  { expanded, onToggle, className = '' },
  ref
): JSX.Element {
  const label = expanded ? 'Закрыть боковую панель' : 'Открыть боковую панель'
  return (
    <IconButton
      ref={ref}
      className={`sidebar-toggle ${className}`.trim()}
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      onClick={onToggle}
    >
      <span aria-hidden>☰</span>
    </IconButton>
  )
})
