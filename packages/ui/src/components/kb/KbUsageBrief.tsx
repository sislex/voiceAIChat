// Короткий блок «Использование БЗ» для ленты рана и модалки задачи: сколько раз
// модель обращалась к базе знаний, какие разделы получила и во что это обошлось.
//
// Почему не `KbUsagePanel`. Панель — модальный инструмент чата с вкладками,
// лентой и фолбэком по истории сообщений. Здесь нужен именно врез в чужой экран:
// три числа и список разделов со ссылками `#/kb/:documentId`. Ссылки — обычные
// якоря, а не кнопки: их открывают в новой вкладке, и это нормальный переход по
// адресу, а не действие.

import { useId, useState, type KeyboardEvent } from 'react'
import type { KbContextMode } from '@shared/types'
import type { KbUsageQuery, KbUsageSectionAggregate, KbUsageTotals } from '@shared/kb'
import { KbFreshnessChip } from './KbFreshnessChip'
import { num, SOURCE_LABEL, STATUS_LABEL, timeOf } from './kbUsageFormat'
import { Button } from '../ui/Button'

export interface KbUsageBriefProps {
  title: string
  totals: KbUsageTotals
  sections: KbUsageSectionAggregate[]
  recent?: KbUsageQuery[]
  /** Режим БЗ (снимок рана): объясняет пустоту настройкой, а не поведением модели. */
  mode?: KbContextMode
  /** Уточнение под заголовком, напр. «по 3 ранам задачи». */
  note?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  testId?: string
}

/** Адрес раздела базы знаний: тот же, что открывает страницу БЗ. */
export function kbDocumentHref(documentId: string): string {
  return `#/kb/${encodeURIComponent(documentId)}`
}

const MODE_LABEL: Record<KbContextMode, string> = {
  auto: 'Автоматический контекст',
  manual: 'Обращения модели к БЗ',
  off: 'База знаний отключена'
}

function SectionRow({ item, recent }: { item: KbUsageSectionAggregate; recent: KbUsageQuery[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const events = recent.filter((query) => query.sections.some((section) =>
    section.documentId === item.documentId && section.anchor === item.anchor
  ))
  const label = `${item.title}${item.heading && item.heading !== item.title ? ` / ${item.heading}` : ''}`
  return (
    <li className="kbu-run-section">
      <button className="kbu-run-section__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <span>{num(item.times)} обр. · {item.autoTimes === item.times ? 'Автоматически добавлено сервером' : item.autoTimes ? 'Авто-контекст и обращения модели' : 'Обращения модели'} · ≈{num(item.estimatedTokens)} ток.</span>
        <span aria-hidden>{open ? '⌃' : '⌄'}</span>
      </button>
      <div className="kbu-run-section__meta">
        <a className="kbu-doc" href={kbDocumentHref(item.documentId)} aria-label={`Открыть «${label}» в базе знаний`}>{item.sourcePath}</a>
        <span>{num(item.chars)} симв. · {timeOf(item.lastAt)}</span>
        <KbFreshnessChip freshness={item.freshness} />
      </div>
      {open && (
        <ul className="kbu-run-events" aria-label={`Обращения к разделу «${label}»`}>
          {events.map((event) => (
            <li key={event.id}>
              <span>{timeOf(event.createdAt)} · {SOURCE_LABEL[event.source]} · {STATUS_LABEL[event.status]}</span>
              <span>{event.ciStepId ? `Шаг ${event.ciStepId}` : 'Основной ход модели'} · {num(event.chars)} симв. · ≈{num(event.estimatedTokens)} ток.</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function KbUsageBrief(props: KbUsageBriefProps): JSX.Element {
  const { totals, sections, recent = [], mode = 'auto', testId = 'kb-usage-brief' } = props
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const status = props.error || totals.errors ? 'Есть ошибки' : props.loading ? 'Выполняется…' : mode === 'off' ? 'Отключена' : totals.queries ? 'Успешно' : 'Обращений пока нет'
  const summary = totals.queries ? `${num(totals.queries)} обращений, ${num(totals.documents)} разделов, примерно ${num(totals.estimatedTokens)} токенов, ${status.toLowerCase()}` : status
  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return
    setOpen(false)
    const trigger = event.currentTarget.previousElementSibling
    if (trigger instanceof HTMLElement) trigger.focus()
  }
  return (
    <section className={`kbu-brief kbu-brief--disclosure${open ? ' is-open' : ''}`} data-testid={testId}>
      <button className="kbu-brief__toggle" aria-expanded={open} aria-controls={panelId}
        aria-label={`Использование базы знаний: ${open ? 'скрыть подробности' : `${summary}. Показать подробности`}`}
        onClick={() => setOpen(!open)}>
        <span className="kbu-brief__icon" aria-hidden>⧉</span>
        <span className="kbu-brief__line" data-testid={`${testId}-nums`}>
          <strong>База знаний</strong>{props.note && <span>{props.note}</span>}<span>{MODE_LABEL[mode]}</span>
          {totals.queries > 0 && <><span>{num(totals.queries)} обращений</span><span>{num(totals.documents)} разделов</span><span>≈{num(totals.estimatedTokens)} токенов</span></>}
          <span className={props.error || totals.errors ? 'kbu-brief__status kbu-brief__status--error' : 'kbu-brief__status'}>{status}</span>
        </span>
        <span className="kbu-brief__chevron" aria-hidden>{props.loading ? '…' : props.error || totals.errors ? '⚠' : open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div id={panelId} className="kbu-run-report" onKeyDown={onPanelKeyDown}>
          {props.loading && !totals.queries ? <p>Загрузка отчёта об использовании БЗ…</p> : props.error ? (
            <div className="kbu-run-error" role="alert"><p>Подробный отчёт загрузить не удалось: {props.error}</p>{props.onRetry && <Button size="sm" onClick={props.onRetry}>Повторить</Button>}</div>
          ) : mode === 'off' ? <p>База знаний была отключена для этого рана.</p> : !totals.queries ? <p>Обращений к базе знаний ещё не было.</p> : (
            <>
              <dl className="kbu-run-summary">
                <div><dt>Режим</dt><dd>{MODE_LABEL[mode]}</dd></div><div><dt>Обращений</dt><dd>{num(totals.queries)}</dd></div>
                <div><dt>Успешно</dt><dd>{num(totals.delivered)}</dd></div><div><dt>С ошибкой</dt><dd>{num(totals.errors)}</dd></div>
                <div><dt>Найдено разделов</dt><dd>{num(totals.sections)}</dd></div><div><dt>Использовано разделов</dt><dd>{num(totals.documents)}</dd></div>
                <div><dt>Передано текста</dt><dd>{num(totals.chars)} симв.</dd></div><div><dt>Объём контекста</dt><dd>≈{num(totals.estimatedTokens)} токенов</dd></div>
              </dl>
              <section><h4>Использованные статьи и разделы</h4>{sections.length ? <ul className="kbu-run-sections">{sections.map((item) => <SectionRow key={`${item.documentId}#${item.anchor}`} item={item} recent={recent} />)}</ul> : <p>Использованных разделов нет.</p>}</section>
              {totals.errors > 0 && <section><h4>Ошибки обращений</h4><ul className="kbu-run-errors">{recent.filter((query) => query.status === 'error').map((query) => <li key={query.id}><strong>{SOURCE_LABEL[query.source]}</strong> · {timeOf(query.createdAt)} · {query.ciStepId ? `шаг ${query.ciStepId}` : 'основной ход'}<br />{query.error || 'Описание ошибки недоступно'} — ран продолжил выполнение.</li>)}</ul></section>}
            </>
          )}
        </div>
      )}
    </section>
  )
}
