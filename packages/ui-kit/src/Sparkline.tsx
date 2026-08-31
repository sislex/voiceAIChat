// График-строка: линия и заливка под ней по ряду чисел.
//
// Своя математика вместо библиотеки: единственный чанк приложения уже почти
// упёрся в бюджет сборки, а всё, что нужно, — путь по точкам. Плюс график
// обязан быть доступным: `role="img"` с текстовой подписью, потому что кривая
// без подписи для скринридера — пустое место.

export interface SparklinePoint {
  /** Подпись точки для оси и для текстовой сводки: «12 авг». */
  label: string
  value: number
}

export interface SparklineProps {
  points: readonly SparklinePoint[]
  /** Что именно показано: «Расход по дням, USD». Уходит в aria-label целиком. */
  label: string
  /** Форматирование значения в подписи (валюта, токены). */
  format?: (value: number) => string
  height?: number
  className?: string
  testId?: string
}

/** Путь линии и путь заливки в системе координат 0..width × 0..height. */
export function sparklinePaths(values: readonly number[], width: number, height: number): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' }
  // Одна точка — короткая горизонталь: иначе делением на нулевой размах
  // получалось бы NaN, и график исчезал целиком.
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = values.length > 1 ? width / (values.length - 1) : width
  const coords = values.map((value, index) => {
    const x = values.length > 1 ? index * step : width / 2
    const y = height - ((value - min) / span) * height
    return `${x.toFixed(2)} ${y.toFixed(2)}`
  })
  const line = `M${coords.join(' L')}`
  return { line, area: `${line} L${width} ${height} L0 ${height}Z` }
}

const WIDTH = 800

export function Sparkline({ points, label, format = (value) => String(value), height = 160, className, testId = 'sparkline' }: SparklineProps): JSX.Element {
  const values = points.map((point) => point.value)
  const { line, area } = sparklinePaths(values, WIDTH, height)
  const peak = points.reduce<SparklinePoint | null>((best, point) => (best === null || point.value > best.value ? point : best), null)
  // Текстовая сводка вместо «графика»: скринридеру важны границы периода и пик,
  // а не форма кривой.
  const summary = points.length === 0
    ? `${label}: данных нет`
    : `${label}: ${points.length} точек, с ${points[0].label} по ${points[points.length - 1].label}, максимум ${format(peak?.value ?? 0)} — ${peak?.label ?? ''}`

  return (
    <div className={['vc-spark', className].filter(Boolean).join(' ')} data-testid={testId}>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" role="img" aria-label={summary}>
        {area && <path className="vc-spark__area" d={area} />}
        {line && <path className="vc-spark__line" d={line} />}
      </svg>
      {points.length > 1 && (
        <div className="vc-spark__labels" aria-hidden="true">
          <span>{points[0].label}</span>
          <span>{points[points.length - 1].label}</span>
        </div>
      )}
    </div>
  )
}
