import { useState } from 'react'

export function WebReaderEngineSelect({ value, onChange }: { value: 'proxy' | 'chromium'; onChange: (engine: 'proxy' | 'chromium') => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  return <label className="web-reader-engine"><span className="vc-sr-only">Движок Web Reader</span>
    <select aria-label="Движок Web Reader" title="Полный браузер подходит для Gmail, Instagram и сложных сайтов" value={value} disabled={busy} onChange={event => {
      const next = event.target.value === 'chromium' ? 'chromium' : 'proxy'
      setBusy(true); setError(null)
      void onChange(next).catch(error => setError(error instanceof Error ? error.message : 'Не удалось переключить браузер')).finally(() => setBusy(false))
    }}><option value="proxy">Быстрый просмотр</option><option value="chromium">Полный браузер</option></select>
    {busy && <span role="status">Переключение…</span>}{error && <span role="alert">{error}</span>}
  </label>
}
