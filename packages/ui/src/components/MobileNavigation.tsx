import { useLayoutEffect, useRef } from 'react'
import { Button } from '@voicechat/ui-kit'
import { MOBILE_QUERY, useMediaQuery } from '@voicechat/ui-foundation/lib/mediaQuery'

export const SHELL_SECTIONS = [
  { id: 'chat', label: 'Чат' },
  { id: 'machines', label: 'Машины' },
  { id: 'board', label: 'Канбан' },
  { id: 'releases', label: 'Релизы' }
] as const
export type ShellSection = typeof SHELL_SECTIONS[number]['id']
export function MobileNavigation({ active, onNavigate, onMore, preview = false }: { active: ShellSection | null; onNavigate: (section: ShellSection) => void; onMore: () => void; preview?: boolean }): JSX.Element | null {
  const phone = useMediaQuery(MOBILE_QUERY)
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = (): void => { document.documentElement.style.setProperty('--vc-shell-bottom', `${node.offsetHeight}px`) }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(node)
    return () => { observer?.disconnect(); document.documentElement.style.removeProperty('--vc-shell-bottom') }
  }, [phone, preview])
  if (!phone && !preview) return null
  return <nav ref={ref} className="mobile-navigation" aria-label="Основные разделы">
    {(['chat', 'board', 'machines', 'releases'] as const).map(id => <Button key={id} variant="ghost" size="sm" data-tour={id} aria-current={active === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
      {SHELL_SECTIONS.find(item => item.id === id)!.label}
    </Button>)}
    <Button variant="ghost" size="sm" onClick={onMore}>Ещё</Button>
  </nav>
}
