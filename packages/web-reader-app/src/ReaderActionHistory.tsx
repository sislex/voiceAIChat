import { useId, useState } from 'react'
import type { WebReaderFrameProps } from './panelContract'
import { previewActionLabel } from './actionLabel'
import type { PreviewAction } from '@shared/previewActions'

type Props = { actions: NonNullable<WebReaderFrameProps['actions']>; onRepeat?: WebReaderFrameProps['onRepeatAction']; onReveal?: WebReaderFrameProps['onRevealAction'] }
/** Steps that touched a concrete element can be shown again on the page. */
function revealSelector(action: PreviewAction): string | null {
  return 'selector' in action && typeof action.selector === 'string' && action.selector && action.kind !== 'read' && action.kind !== 'scroll' ? action.selector : null
}
/** На телефоне лента раскрытой по умолчанию отнимает у страницы половину экрана. */
function defaultExpanded(): boolean {
  try { return !(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 560px)').matches) } catch { return true }
}
function timeLabel(at: number | undefined): string {
  if (!at) return ''
  try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}
function siteName(address: string | null): string {
  try { return address ? new URL(address).host : '' } catch { return '' }
}
export function ReaderActionHistory({ actions, onRepeat, onReveal }: Props): JSX.Element | null {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [query, setQuery] = useState('')
  const id = useId()
  if (!actions.length) return null
  const needle = query.trim().toLocaleLowerCase()
  const rows = actions.map((item, index) => ({ ...item, index, label: previewActionLabel(item.action), site: siteName(item.address) }))
  const shown = rows.filter(row => !needle || [row.label, row.title, row.site].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle))
  return <section className="webpreview-scenario webpreview-history" aria-label="Действия ассистента">
    <div className="webpreview-scenario-header">
      <button type="button" className="vc-btn vc-btn--ghost" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>Действия ассистента</button>
      <span aria-label="Количество действий">{actions.length}</span>
    </div>
    <div id={id} hidden={!expanded}>
      {actions.length > 1 && <div className="webpreview-history-search">
        <input type="search" aria-label="Поиск действий" placeholder="Найти действие или страницу" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setQuery('') } }} />
        {query && <button type="button" className="vc-btn vc-btn--ghost" onClick={() => setQuery('')}>Очистить поиск</button>}
      </div>}
      {shown.length === 0 && <p role="status">Действия не найдены</p>}
      <ol>{shown.map(item => <li key={item.id}>
        <div className="webpreview-history-description"><span>{item.label}</span>{item.title && <small>{item.title}</small>}{item.site && <small>{item.site}{timeLabel(item.at) ? ` · ${timeLabel(item.at)}` : ''}</small>}{!item.site && timeLabel(item.at) && <small>{timeLabel(item.at)}</small>}</div>
        {onReveal && revealSelector(item.action) && <button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" aria-label={`Показать на странице элемент действия ${item.index + 1}`} onClick={() => onReveal(revealSelector(item.action)!)}>Показать</button>}
        {onRepeat && <button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" aria-label={`Повторить действие ${item.index + 1}: ${item.label}`} onClick={() => onRepeat(item.action)}>Повторить</button>}
      </li>)}</ol>
    </div>
  </section>
}
