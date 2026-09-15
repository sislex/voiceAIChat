import { useEffect, useRef, useState } from 'react'
import { Button } from '@voicechat/ui-kit'
import type { WebRecorderScenarioStep } from '@shared/webRecorder'
import { exportScenarioDocument, parseScenarioDocument, SCENARIO_FILE_LIMIT, type ScenarioDocument } from './scenarioDocument'
interface Props { pageUrl: string | null; steps: readonly WebRecorderScenarioStep[]; disabled: boolean; onImport: (steps: WebRecorderScenarioStep[]) => void }
export function ScenarioTransfer({ pageUrl, steps, disabled, onImport }: Props): JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const [pending, setPending] = useState<ScenarioDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  useEffect(() => { generation.current++; setPending(null); setError(null); setReading(false); return () => { generation.current++ } }, [pageUrl])
  const read = async (file: File): Promise<void> => {
    const token = ++generation.current; setPending(null); setError(null); setReading(true)
    try {
      if (file.size > SCENARIO_FILE_LIMIT) throw new Error('Файл сценария превышает 1 МБ.')
      const doc = parseScenarioDocument(await file.text())
      if (token === generation.current) setPending(doc)
    } catch (e) { if (token === generation.current) setError(e instanceof Error ? e.message : 'Не удалось прочитать файл.') }
    finally { if (token === generation.current) setReading(false) }
  }
  const download = (): void => {
    try {
      const blob = new Blob([exportScenarioDocument(pageUrl!, steps)], { type: 'application/json' })
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'web-reader-scenario.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 0); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось экспортировать сценарий.') }
  }
  return <section className="webpreview-transfer" aria-label="Файл сценария">
    <Button size="sm" disabled={disabled || !pageUrl} onClick={() => input.current?.click()}>Импорт JSON</Button>
    <Button size="sm" disabled={disabled || !pageUrl || !steps.length} onClick={download}>Экспорт JSON</Button>
    <input ref={input} type="file" accept=".json,application/json" aria-label="Файл сценария JSON" hidden onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file)
    }} />
    {reading && <span role="status">Читаем сценарий…</span>}
    {error && <span role="alert">{error}</span>}
    {pending && <div role="group" aria-label="Проверка импорта">
      <p>Источник: {pending.pageUrl} · Шагов: {pending.steps.length}. Текущий сценарий будет заменён; страница останется открытой.</p>
      <Button size="sm" disabled={disabled || !pageUrl} onClick={() => { onImport(pending.steps); setPending(null) }}>Применить к текущей странице</Button>
      <Button size="sm" onClick={() => { generation.current++; setPending(null); setError(null) }}>Отменить импорт</Button>
    </div>}
  </section>
}
