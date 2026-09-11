import { useState } from 'react'
import { Button } from '@voicechat/ui-kit'
export interface DiagnosticsStep { requestId: string; action: string; ok: boolean; durationMs: number }
export function DiagnosticHistory({ steps }: { steps: readonly DiagnosticsStep[] }): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const [failedOnly, setFailedOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const failed = steps.filter(step => !step.ok).length
  const durationMs = steps.reduce((sum, step) => sum + step.durationMs, 0)
  const visible = steps.filter(step => (!failedOnly || !step.ok) && step.action.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const download = (): void => {
    try {
      const blob = new Blob([JSON.stringify({ version: 1, total: steps.length, failed, durationMs, steps }, null, 2)], { type: 'application/json' })
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'web-reader-diagnostics.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 0); setError(null)
    } catch { setError('Не удалось сохранить диагностику.') }
  }
  return <section className="webpreview-scenario" aria-label="Диагностика Web Reader">
    <strong>Диагностика: {steps.length} шаг. · Успешно: {steps.length - failed} · Ошибок: {failed} · Всего: {durationMs} мс</strong>
    <Button size="sm" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Показать детали диагностики' : 'Скрыть детали диагностики'}</Button>
    <Button size="sm" disabled={!steps.length} onClick={download}>Скачать диагностику</Button>
    {error && <p role="alert">{error}</p>}
    {!collapsed && <>
      <input aria-label="Поиск действий диагностики" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery('') }} />
      <label><input type="checkbox" checked={failedOnly} onChange={event => setFailedOnly(event.target.checked)} />Только ошибки диагностики</label>
      {visible.length ? <ol>{visible.map(step => <li key={step.requestId} data-status={step.ok ? 'passed' : 'failed'}>{step.ok ? '✓' : '✕'} <code>{step.action}</code> — {step.durationMs} мс</li>)}</ol> : <p role="status">{steps.length ? 'Нет подходящих действий.' : 'Результатов пока нет.'}</p>}
    </>}
  </section>
}
