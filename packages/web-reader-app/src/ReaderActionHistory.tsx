import { useId, useState } from 'react'
import type { WebReaderFrameProps } from './panelContract'
import { previewActionLabel } from './actionLabel'

type Props = { actions: NonNullable<WebReaderFrameProps['actions']>; onRepeat?: WebReaderFrameProps['onRepeatAction'] }
function siteName(address: string | null): string {
  try { return address ? new URL(address).host : '' } catch { return '' }
}
export function ReaderActionHistory({ actions, onRepeat }: Props): JSX.Element | null {
  const [expanded, setExpanded] = useState(true)
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
      <div className="webpreview-history-search">
        <input type="search" aria-label="Поиск действий" placeholder="Найти действие или страницу" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setQuery('') } }} />
        {query && <button type="button" className="vc-btn vc-btn--ghost" onClick={() => setQuery('')}>Очистить поиск</button>}
      </div>
      {shown.length === 0 && <p role="status">Действия не найдены</p>}
      <ol>{shown.map(item => <li key={item.id}>
        <div className="webpreview-history-description"><span>{item.label}</span>{item.title && <small>{item.title}</small>}{item.site && <small>{item.site}</small>}</div>
        {onRepeat && <button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" aria-label={`Повторить действие ${item.index + 1}: ${item.label}`} onClick={() => onRepeat(item.action)}>Повторить</button>}
      </li>)}</ol>
    </div>
  </section>
}
