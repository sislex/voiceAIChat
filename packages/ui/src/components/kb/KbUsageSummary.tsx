// Сводка панели: плитки чисел плюс чип режима БЗ и статус индекса.
//
// Про токены здесь написано прямым текстом: они оценка (chars/4), а не биллинг
// хода. Разложить `usage.inputTokens` на «сколько от БЗ» нельзя — CLI отдаёт
// суммарный вход промпта, и без этой оговорки плитка «≈ токенов» читалась бы как
// счёт за базу знаний.

import type { KbContextMode } from '@shared/types'
import type { KbStatus, KbUsageTotals } from '@shared/kb'
import { kbUsageShare } from '../../lib/kbUsage'
import { num, timeOf } from './kbUsageFormat'

export const KB_MODE_LABEL: Record<KbContextMode, string> = {
  auto: 'авто-контекст + инструменты',
  manual: 'по запросу модели',
  off: 'выключена'
}

export interface KbUsageSummaryProps {
  totals: KbUsageTotals
  mode: KbContextMode
  /** Инструменты mcp__kb__* включены администратором и индекс доступен. */
  toolEnabled: boolean
  /** Статус индекса БЗ (null — ещё не читали). */
  status?: KbStatus | null
  /** Проектная сводка: вместо режима чата показываем число чатов. */
  conversations?: number
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="kbu-tile">
      <span className="kbu-tile__val">{value}</span>
      <span className="kbu-tile__lbl">{label}</span>
      {hint && <span className="kbu-tile__hint">{hint}</span>}
    </div>
  )
}

export function KbUsageSummary({ totals, mode, toolEnabled, status, conversations }: KbUsageSummaryProps): JSX.Element {
  const share = kbUsageShare(totals)
  return (
    <section className="kbu-summary" aria-label="Сводка использования базы знаний">
      <div className="kbu-chips">
        {conversations === undefined ? (
          <span className={`kbu-mode kbu-mode--${mode}`} data-testid="kb-usage-mode">Режим БЗ: {KB_MODE_LABEL[mode]}</span>
        ) : (
          <span className="kbu-mode" data-testid="kb-usage-mode">Чатов с обращениями: {num(conversations)}</span>
        )}
        {!toolEnabled && (
          <span className="kbu-warn" data-testid="kb-usage-tool-off">инструмент БЗ отключён администратором</span>
        )}
        <span className="kbu-index">
          {status ? (status.available ? `индекс: ${num(status.documents)} документов · ${num(status.chunks)} разделов` : 'индекс базы знаний недоступен') : 'индекс: проверяем…'}
        </span>
      </div>
      <div className="kbu-tiles">
        <Tile label="обращений" value={num(totals.queries)} hint={totals.toolQueries ? `из них ${num(totals.toolQueries)} от модели` : 'все — авто-контекст'} />
        <Tile label="разделов" value={num(totals.sections)} hint={`из ${num(totals.documents)} документ(ов)`} />
        <Tile label="символов" value={num(totals.chars)} hint="точная длина текста, отданного модели" />
        <Tile label="≈ токенов" value={num(totals.estimatedTokens)} hint="оценка chars / 4" />
        <Tile label="доля промпта" value={share === null ? '—' : `${share}%`} hint={share === null ? 'размер промптов неизвестен' : `от ${num(totals.promptChars)} симв.`} />
        <Tile label="последнее" value={timeOf(totals.lastAt)} hint={totals.errors ? `ошибок: ${num(totals.errors)}` : totals.empty ? `пустых: ${num(totals.empty)}` : undefined} />
      </div>
      <p className="kbu-note" data-testid="kb-usage-estimate-note">
        Токены базы знаний — оценка по символам (chars / 4), а не биллинговые токены хода:
        CLI отдаёт только суммарный вход промпта, разложить его по источникам нельзя.
      </p>
    </section>
  )
}
