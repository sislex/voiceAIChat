import { useEffect, type RefObject } from 'react'

/** Hidden panels and disabled fieldsets cannot be focus-loop boundaries. */
export function focusableNodes(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, summary, [tabindex]')].filter(node => {
    if (node.tabIndex < 0 || node.matches(':disabled') || node.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    if (node instanceof HTMLInputElement && node.type === 'hidden') return false
    const closedDetails = node.closest('details:not([open])')
    if (closedDetails && !closedDetails.querySelector('summary')?.contains(node)) return false
    for (let current: HTMLElement | null = node; current; current = current.parentElement) {
      const style = getComputedStyle(current)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    }
    return true
  })
}

/** Modal focus ownership is independent of its visual frame and stack registration. */
export function useFocusTrap(panelRef: RefObject<HTMLElement>, top: boolean, initialFocusRef?: RefObject<HTMLElement>, headRef?: RefObject<HTMLElement>): void {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const nodes = panel ? focusableNodes(panel) : []
    const target = initialFocusRef?.current ?? nodes.find(node => !headRef?.current?.contains(node)) ?? nodes[0] ?? panel
    target?.focus()
    return () => {
      if (opener?.isConnected && typeof opener.focus === 'function') opener.focus()
    }
  }, [])
  useEffect(() => {
    if (!top) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = focusableNodes(panel)
      if (!nodes.length) {
        event.preventDefault()
        panel.focus()
        return
      }
      const edge = event.shiftKey ? nodes[nodes.length - 1] : nodes[0]
      const active = document.activeElement
      const escaped = !nodes.includes(active as HTMLElement)
      const atEdge = active === (event.shiftKey ? nodes[0] : nodes[nodes.length - 1])
      if (!escaped && !atEdge) return
      event.preventDefault()
      edge.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [top])
}
