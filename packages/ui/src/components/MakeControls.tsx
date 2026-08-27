// Поля панели Controls (п.14): тип поля выбирается по значению arg и по `argTypes` из CSF
// (control: 'range' | 'color' | 'select' | 'text' | 'boolean' | 'number' | 'object', min/max/step,
// options). Массивы и объекты редактируются как JSON с проверкой — невалидный текст не уходит
// в раннер, а подсвечивается.
import { useEffect, useState } from 'react'

export interface ArgType {
  control?: 'range' | 'color' | 'select' | 'text' | 'boolean' | 'number' | 'object' | 'radio'
  min?: number
  max?: number
  step?: number
  options?: Array<string | number>
  description?: string
}

export interface MakeControlFieldProps {
  name: string
  base: unknown
  value: unknown
  argType?: ArgType
  /** Значения того же ключа из других стори (enum-подобные). */
  enumOptions?: string[]
  onChange: (value: unknown) => void
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i
const READ_ONLY_RE = /^\[(function|element)\]$/

/** Какое поле рисовать: явный control из argTypes важнее эвристики по значению. */
export function controlKind(base: unknown, argType?: ArgType, enumOptions?: string[]): 'boolean' | 'number' | 'range' | 'color' | 'select' | 'text' | 'json' | 'readonly' {
  if (argType?.control === 'range') return 'range'
  if (argType?.control === 'color') return 'color'
  if (argType?.control === 'select' || argType?.control === 'radio' || (argType?.options && argType.options.length > 0)) return 'select'
  if (argType?.control === 'object') return 'json'
  if (typeof base === 'boolean') return 'boolean'
  if (typeof base === 'number') return 'number'
  if (typeof base === 'string') {
    if (READ_ONLY_RE.test(base)) return 'readonly'
    if (COLOR_RE.test(base)) return 'color'
    if (enumOptions && enumOptions.length >= 2) return 'select'
    return 'text'
  }
  if (base === null || base === undefined) return 'text'
  return 'json'
}

/** rgb()/hsl() → #hex для <input type=color>; уже hex — как есть; иначе чёрный. */
export function colorToHex(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value
  if (/^#[0-9a-f]{3}$/i.test(value)) return '#' + value.slice(1).split('').map((c) => c + c).join('')
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  return '#000000'
}

export function MakeControlField({ name, base, value, argType, enumOptions, onChange }: MakeControlFieldProps): JSX.Element {
  const id = `make-arg-${name}`
  const kind = controlKind(base, argType, enumOptions)
  const label = <span title={argType?.description}>{name}</span>
  if (kind === 'boolean') return <label className="make-control" htmlFor={id}>{label}<input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /></label>
  if (kind === 'number') return <label className="make-control" htmlFor={id}>{label}<input id={id} type="number" value={Number(value)} step={argType?.step} min={argType?.min} max={argType?.max} onChange={(e) => onChange(Number(e.target.value))} /></label>
  if (kind === 'range') {
    const min = argType?.min ?? 0, max = argType?.max ?? 100, step = argType?.step ?? 1
    return (
      <label className="make-control" htmlFor={id}>{label}
        <span className="make-control-range"><input id={id} type="range" min={min} max={max} step={step} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} /><output>{String(value)}</output></span>
      </label>
    )
  }
  if (kind === 'color') {
    const current = String(value ?? '')
    return (
      <label className="make-control" htmlFor={id}>{label}
        <span className="make-control-color"><input id={id} type="color" value={colorToHex(current)} onChange={(e) => onChange(e.target.value)} /><code>{current}</code></span>
      </label>
    )
  }
  if (kind === 'select') {
    const opts = (argType?.options ?? enumOptions ?? []).map(String)
    const current = String(value ?? '')
    return (
      <label className="make-control" htmlFor={id}>{label}
        <select id={id} value={current} onChange={(e) => { const raw = e.target.value; const original = (argType?.options ?? []).find((o) => String(o) === raw); onChange(original !== undefined ? original : raw) }}>
          {!opts.includes(current) && <option value={current}>{current}</option>}
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    )
  }
  if (kind === 'json') return <JsonField id={id} label={label} value={value} onChange={onChange} />
  if (kind === 'readonly') return <div className="make-control make-control--ro">{label}<code>{String(base)}</code></div>
  return <label className="make-control" htmlFor={id}>{label}<input id={id} type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} /></label>
}

function JsonField({ id, label, value, onChange }: { id: string; label: JSX.Element; value: unknown; onChange: (v: unknown) => void }): JSX.Element {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setError(null) }, [value])
  return (
    <label className="make-control make-control--json" htmlFor={id}>{label}
      <span className="make-control-json">
        <textarea id={id} value={text} rows={Math.min(8, Math.max(2, text.split('\n').length))} spellCheck={false} aria-invalid={error !== null}
          onChange={(e) => {
            setText(e.target.value)
            try { onChange(JSON.parse(e.target.value)); setError(null) } catch (err) { setError(err instanceof Error ? err.message : 'Невалидный JSON') }
          }} />
        {error && <small className="make-control-error" role="alert">JSON: {error}</small>}
      </span>
    </label>
  )
}
