import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { WidgetAssistantContext, WidgetAssistantProposal } from '@shared/widgetAssistant'
import { widgetProposalDiff } from '@shared/widgetAssistant'

export interface WidgetAssistantFrameProps {
  widget: ReactNode
  assistant: ReactNode
  open: boolean
  onOpenChange?: (open: boolean) => void
  mode?: 'embedded' | 'page'
  storageKey?: string
  title?: string
  /** Optional replacement for the static assistant title in the panel header. */
  assistantHeader?: ReactNode
  /** Ассистент рисует шапку сам (макет «Проект 14»): рамка не дублирует заголовок и крестик. */
  hideHeader?: boolean
}

/** Universal split shell. It owns layout only; widget and assistant communicate through shared contracts. */
export function WidgetAssistantFrame({ widget, assistant, open, onOpenChange, mode = 'embedded', storageKey = 'voicechat.widgetAssistantWidth', title = 'Ассистент', assistantHeader, hideHeader = false }: WidgetAssistantFrameProps): JSX.Element {
  const [mobileView, setMobileView] = useState<'widget' | 'assistant'>('widget')
  const [width, setWidth] = useState(() => {
    const saved = Number(globalThis.localStorage?.getItem(storageKey))
    return Number.isFinite(saved) && saved >= 25 && saved <= 60 ? saved : 36
  })
  const resize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const root = event.currentTarget.parentElement
    if (!root) return
    const move = (pointer: PointerEvent): void => {
      const rect = root.getBoundingClientRect()
      const next = Math.min(60, Math.max(25, ((rect.right - pointer.clientX) / rect.width) * 100))
      setWidth(next)
      globalThis.localStorage?.setItem(storageKey, String(next))
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  return <section className={`widget-assistant widget-assistant--${mode} widget-assistant--${open ? 'open' : 'closed'} widget-assistant--mobile-${mobileView}`} style={{ '--widget-assistant-width': `${width}%` } as CSSProperties} data-testid="widget-assistant-frame">
    {open && <nav className="widget-assistant-tabs" aria-label="Область страницы"><div role="tablist"><button role="tab" aria-selected={mobileView === 'widget'} onClick={() => setMobileView('widget')}>Виджет</button><button role="tab" aria-selected={mobileView === 'assistant'} onClick={() => setMobileView('assistant')}>{title}</button></div></nav>}
    <div className="widget-assistant-widget">{widget}</div>
    {open && <><div className="widget-assistant-divider" onPointerDown={resize}><div role="separator" aria-label="Изменить ширину ассистента" aria-orientation="vertical" /></div><aside className="widget-assistant-panel" aria-label={title}>{!hideHeader && <header>{assistantHeader ?? <strong>{title}</strong>}{onOpenChange && <button type="button" aria-label="Закрыть ассистента" onClick={() => onOpenChange(false)}>×</button>}</header>}{assistant}</aside></>}
  </section>
}

export interface WidgetProposalCardProps {
  proposal: WidgetAssistantProposal
  context: WidgetAssistantContext<any>
  onConfirm: () => void
  onCancel: () => void
}

/** A proposal never executes on render; only the explicit Apply button invokes its command. */
export function WidgetProposalCard({ proposal, context, onConfirm, onCancel }: WidgetProposalCardProps): JSX.Element {
  const rows = widgetProposalDiff(proposal, context)
  return <section className="widget-proposal" aria-label="Предложение ассистента">
    {proposal.reason && <p>{proposal.reason}</p>}
    <dl>{rows.map((row) => <div key={row.field}><dt>{row.field}</dt><dd><del>{String(row.before ?? '—')}</del><ins>{String(row.after ?? '—')}</ins></dd></div>)}</dl>
    <div className="widget-proposal-actions"><button type="button" className="vc-btn vc-btn--primary" onClick={onConfirm}>Применить</button><button type="button" className="vc-btn vc-btn--secondary" onClick={onCancel}>Отмена</button></div>
  </section>
}
