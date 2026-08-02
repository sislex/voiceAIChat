// Короткий блок «Использование БЗ» для ленты рана и модалки задачи: сколько раз
// модель обращалась к базе знаний, какие разделы получила и во что это обошлось.
//
// Почему не `KbUsagePanel`. Панель — модальный инструмент чата с вкладками,
// лентой и фолбэком по истории сообщений. Здесь нужен именно врез в чужой экран:
// три числа и список разделов со ссылками `#/kb/:documentId`. Ссылки — обычные
// якоря, а не кнопки: их открывают в новой вкладке, и это нормальный переход по
// адресу, а не действие.

import type { KbContextMode } from '@shared/types'
import type { KbUsageSectionAggregate, KbUsageTotals } from '@shared/kb'
import { KbFreshnessChip } from './KbFreshnessChip'
import { num } from './kbUsageFormat'

/** Сколько разделов показываем: остальные — за счётчиком «ещё N». */
const MAX_SECTIONS = 8

export interface KbUsageBriefProps {
  title: string
  totals: KbUsageTotals
  sections: KbUsageSectionAggregate[]
  /** Режим БЗ (снимок рана): объясняет пустоту настройкой, а не поведением модели. */
  mode?: KbContextMode
  /** Уточнение под заголовком, напр. «по 3 ранам задачи». */
  note?: string
  loading?: boolean
  error?: string | null
  testId?: string
}

/** Адрес раздела базы знаний: тот же, что открывает страницу БЗ. */
export function kbDocumentHref(documentId: string): string {
  return `#/kb/${encodeURIComponent(documentId)}`
}

export function KbUsageBrief(props: KbUsageBriefProps): JSX.Element {
  const { totals, sections, mode = 'auto', testId = 'kb-usage-brief' } = props
  const shown = sections.slice(0, MAX_SECTIONS)
  return (
    <div className="kbu-brief" data-testid={testId}>
      <div className="kbu-brief__head">
        <span className="ci-task-title">{props.title}</span>
        {props.note && <span className="kbu-brief__note">{props.note}</span>}
        {mode === 'off' && <span className="lozenge">БЗ выключена</span>}
        {mode === 'manual' && <span className="lozenge">по запросу модели</span>}
      </div>
      {props.error ? (
        <p className="kbu-brief__empty">Статистику базы знаний прочитать не удалось: {props.error}</p>
      ) : props.loading && !totals.queries ? (
        <p className="kbu-brief__empty">Считаем обращения…</p>
      ) : totals.queries === 0 ? (
        <p className="kbu-brief__empty">
          {mode === 'off'
            ? 'Режим «выключена»: модель работала без базы знаний.'
            : 'Обращений к базе знаний не было.'}
        </p>
      ) : (
        <>
          <p className="kbu-brief__nums" data-testid={`${testId}-nums`}>
            {num(totals.queries)} обращений · {num(totals.documents)} разделов · {num(totals.chars)} симв. · ≈ {num(totals.estimatedTokens)} ток.
          </p>
          <ul className="kbu-brief__list">
            {shown.map((item) => (
              <li key={`${item.documentId}#${item.anchor}`}>
                <a className="kbu-doc" href={kbDocumentHref(item.documentId)}>
                  {item.title}
                  {item.heading && item.heading !== item.title ? ` / ${item.heading}` : ''}
                </a>
                <span className="kbu-brief__times">×{num(item.times)}</span>
                <KbFreshnessChip freshness={item.freshness} />
              </li>
            ))}
          </ul>
          {sections.length > shown.length && (
            <p className="kbu-brief__more">…и ещё {num(sections.length - shown.length)} разделов</p>
          )}
        </>
      )}
    </div>
  )
}
