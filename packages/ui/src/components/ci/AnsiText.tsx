// Строка лога с ANSI-раскраской.
//
// npm, vitest и tsc печатают цвет escape-последовательностями, а лента шага и
// merge-терминал показывали их как есть: каждая строка теста начиналась с
// «[1m[32m✓[0m» — цвет терялся, а мусор оставался. Разбор — чистая функция
// `parseAnsi` в `@shared/ansi`, здесь только отрисовка.
//
// Цвета берутся из токенов `--ansi-*` (палитра лога), а не из hex в разметке:
// светлый и тёмный терминал у нас одинаково тёмные, но токен всё равно нужен —
// иначе цвет не поправить в одном месте.
import { parseAnsi, type AnsiSegment } from '@shared/ansi'

function className(segment: AnsiSegment): string | undefined {
  const parts: string[] = []
  if (segment.color) parts.push(`ansi-fg-${segment.color}${segment.bright ? '-bright' : ''}`)
  if (segment.background) parts.push(`ansi-bg-${segment.background}`)
  if (segment.bold) parts.push('ansi-bold')
  if (segment.italic) parts.push('ansi-italic')
  if (segment.underline) parts.push('ansi-underline')
  if (segment.inverse) parts.push('ansi-inverse')
  return parts.length ? parts.join(' ') : undefined
}

/** Отрисованный текст: без разметки — один текстовый узел, без лишних span. */
export function AnsiText({ children }: { children: string }): JSX.Element {
  const segments = parseAnsi(children)
  if (segments.length === 1 && !className(segments[0])) return <>{segments[0].text}</>
  return <>{segments.map((segment, index) => {
    const css = className(segment)
    return css
      ? <span key={index} className={css}>{segment.text}</span>
      : <span key={index}>{segment.text}</span>
  })}</>
}
