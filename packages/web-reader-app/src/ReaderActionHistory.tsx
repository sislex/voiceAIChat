import { useEffect, useId, useRef, useState } from 'react'
import type { WebReaderFrameProps } from './panelContract'
import { previewActionLabel } from './actionLabel'
import type { PreviewAction } from '@shared/previewActions'

type Props = { actions: NonNullable<WebReaderFrameProps['actions']>; onRepeat?: WebReaderFrameProps['onRepeatAction']; onReveal?: WebReaderFrameProps['onRevealAction']; onClear?: WebReaderFrameProps['onClearActions']; currentUrl?: string | null; manual?: boolean }
/** Steps that touched a concrete element can be shown again on the page. */
function revealSelector(action: PreviewAction): { selector?: string; text?: string } | null {
  if (action.kind === 'read' || action.kind === 'scroll' || action.kind === 'open' || action.kind === 'sequence' || action.kind === 'fill') return null
  if ('selector' in action && typeof action.selector === 'string' && action.selector) return { selector: action.selector }
  if ('text' in action && typeof action.text === 'string' && action.text) return { text: action.text }
  return null
}
/** На телефоне лента раскрытой по умолчанию отнимает у страницы половину экрана. */
function defaultExpanded(): boolean {
  try { return !(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 560px)').matches) } catch { return true }
}
function timeLabel(at: number | undefined): string {
  if (!at) return ''
  // The freshest steps read as "just now"; older ones keep the clock time.
  if (Date.now() - at < 60_000) return 'только что'
  try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}
function siteName(address: string | null): string {
  try { return address ? new URL(address).host : '' } catch { return '' }
}
export function ReaderActionHistory({ actions, onRepeat, onReveal, onClear, currentUrl, manual = false }: Props): JSX.Element | null {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [query, setQuery] = useState('')
  const [failedOnly, setFailedOnly] = useState(false)
  const [detailsFor, setDetailsFor] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | 'actions' | 'checks' | 'reads'>('all')
  const KIND_ICONS: Record<string, string> = { click: '🖱', type: '⌨', fill: '⌨', press: '⌨', choose: '☑', set: '☑', read: '👁', find: '🔍', check: '✅', open: '🌐', back: '↩', forward: '↪', scroll: '↕', hover: '👆', screenshot: '📷', errors: '⚠', wait: '⏳', show: '👉', sequence: '📋', status: 'ℹ' }
  const kindGroup = (kind: string): 'actions' | 'checks' | 'reads' => kind === 'check' ? 'checks' : ['read', 'find', 'errors', 'status', 'screenshot', 'changes', 'report'].includes(kind) ? 'reads' : 'actions'
  const id = useId()
  const listRef = useRef<HTMLOListElement>(null)
  // New steps land at the bottom of a scrolling list; keep the latest one in view like a chat.
  useEffect(() => { const list = listRef.current; if (list) list.scrollTop = list.scrollHeight }, [actions.length])
  if (!actions.length) return null
  const needle = query.trim().toLocaleLowerCase()
  const rows = actions.map((item, index) => ({ ...item, index, label: previewActionLabel(item.action), site: siteName(item.address) }))
  const failed = rows.filter(row => row.ok === false).length
  const passed = rows.filter(row => row.ok === true).length
  const shown = rows.filter(row => (!needle || [row.label, row.title, row.site, row.summary].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)) && (!failedOnly || row.ok === false) && (kindFilter === 'all' || kindGroup(row.action.kind) === kindFilter))
  return <section className="webpreview-scenario webpreview-history" aria-label="Действия ассистента">
    <div className="webpreview-scenario-header">
      <button type="button" className="vc-btn vc-btn--ghost" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>Действия ассистента</button>
      <span aria-label="Количество действий">{actions.length}</span>
      {(passed > 0 || failed > 0) && <span className="webpreview-history-verdicts" aria-label={`Проверок пройдено ${passed}, не пройдено ${failed}`}>✓ {passed} · ✗ {failed}</span>}
      {failed > 0 && <button type="button" className="vc-btn vc-btn--ghost vc-btn--sm" aria-pressed={failedOnly} onClick={() => setFailedOnly(value => !value)}>Только ✗ ({failed})</button>}
      <button type="button" className="vc-btn vc-btn--ghost vc-btn--sm" aria-label="Скопировать ленту действий" onClick={() => { const lines = rows.map(row => `${timeLabel(row.at) ? timeLabel(row.at) + ' ' : ''}${row.ok === undefined ? '' : row.ok ? '✓ ' : '✗ '}${row.label}${row.summary ? ' — ' + row.summary : ''}${row.site ? ' (' + row.site + ')' : ''}`); void navigator.clipboard?.writeText(lines.join('\n')).catch(() => {}) }}>Копировать</button>
      {onClear && <button type="button" className="vc-btn vc-btn--ghost vc-btn--sm" aria-label="Очистить ленту действий" onClick={onClear}>Очистить</button>}
    </div>
    <div id={id} hidden={!expanded}>
      {actions.length > 3 && <label className="webpreview-history-kind"><span className="vc-sr-only">Показывать</span><select aria-label="Какие шаги показывать" value={kindFilter} onChange={event => setKindFilter(event.target.value as typeof kindFilter)}><option value="all">Все шаги</option><option value="actions">Действия</option><option value="checks">Проверки</option><option value="reads">Чтение</option></select></label>}
      {actions.length > 1 && <div className="webpreview-history-search">
        <input type="search" aria-label="Поиск действий" placeholder="Найти действие или страницу" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setQuery('') } }} />
        {query && <button type="button" className="vc-btn vc-btn--ghost" onClick={() => setQuery('')}>Очистить поиск</button>}
      </div>}
      {shown.length === 0 && <p role="status">Действия не найдены</p>}
      {/* Длинный сеанс читается по страницам: заголовок появляется там, где ассистент перешёл на другой сайт. */}
      <ol ref={listRef}>{shown.map((item, index) => <li key={item.id}>
        {item.site && item.site !== shown[index - 1]?.site && <b className="webpreview-history-page">{item.title || item.site}</b>}
        <div className="webpreview-history-description" data-ok={item.ok === undefined ? undefined : item.ok ? 'true' : 'false'}><span>{item.ok === undefined && KIND_ICONS[item.action.kind] && <span className="webpreview-history-icon" aria-hidden="true">{KIND_ICONS[item.action.kind]} </span>}{item.ok !== undefined && <span className="webpreview-history-verdict" aria-label={item.ok ? 'Проверка пройдена' : 'Проверка не пройдена'}>{item.ok ? '✓' : '✗'} </span>}<span className="webpreview-history-label">{item.label}</span>{item.count && item.count > 1 ? <span className="webpreview-history-count" aria-label={`повторено ${item.count} раз`}> ×{item.count}</span> : null}</span>{item.summary && <small className="webpreview-history-summary">{item.summary}</small>}{item.title && !item.site && <small>{item.title}</small>}{item.site && <small title={[item.address, item.at ? new Date(item.at).toLocaleString() : ''].filter(Boolean).join(' · ') || undefined}>{item.site}{timeLabel(item.at) ? ` · ${timeLabel(item.at)}` : ''}</small>}{!item.site && timeLabel(item.at) && <small>{timeLabel(item.at)}</small>}</div>
        {onReveal && revealSelector(item.action) && <button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" aria-label={`Показать на странице элемент действия ${item.index + 1}`} disabled={manual || Boolean(currentUrl && item.address && item.address !== currentUrl)} title={manual ? 'Управляете вы' : currentUrl && item.address && item.address !== currentUrl ? 'Открыта другая страница' : undefined} onClick={() => onReveal(revealSelector(item.action)!)}>Показать</button>}
        {onRepeat && <button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" aria-label={`Повторить действие ${item.index + 1}: ${item.label}`} disabled={manual} title={manual ? 'Управляете вы' : undefined} onClick={() => onRepeat(item.action)}>Повторить</button>}
        {onRepeat && item.address && currentUrl && item.address !== currentUrl && <button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" disabled={manual} aria-label={`Открыть страницу действия ${item.index + 1}`} onClick={() => onRepeat({ kind: 'open', url: item.address! })}>Открыть страницу</button>}
        <button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" aria-expanded={detailsFor === item.id} aria-label={`Подробности действия ${item.index + 1}`} onClick={() => setDetailsFor(current => current === item.id ? null : item.id)}>…</button>
        {detailsFor === item.id && <pre className="webpreview-history-details">{JSON.stringify(item.action, null, 1)}</pre>}
      </li>)}</ol>
    </div>
  </section>
}
