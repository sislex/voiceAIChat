// Панель стилей выбранного элемента превью (п.8 дорожной карты): правки применяются в iframe
// мгновенно (inline через postMessage), а «Записать в CSS» дописывает правило в таблицу стилей
// проекта — так «point-and-edit» из Figma Make остаётся в файлах, а не только на экране.
import { useEffect, useState } from 'react'
import { Button } from '@voicechat/ui-kit'

export const STYLE_PROPS = ['color', 'background-color', 'font-size', 'font-weight', 'text-align', 'padding', 'margin', 'border-radius'] as const
export type StyleProp = typeof STYLE_PROPS[number]
export type StyleValues = Partial<Record<StyleProp, string>>

export interface MakeStylePanelProps {
  /** Селектор из инспектора — стартовое значение для правила. */
  selector: string
  /** id/классы элемента — для короткого селектора по умолчанию. */
  id?: string
  className?: string
  /** Вычисленные стили элемента (из превью). */
  computed: StyleValues
  onPreview: (values: StyleValues) => void
  onWrite: (selector: string, values: StyleValues) => Promise<void>
  onReset: () => void
}

/** Короткий CSS-селектор: #id → .первый-класс → селектор инспектора. */
export function shortSelector(selector: string, id?: string, className?: string): string {
  if (id) return `#${id}`
  const cls = (className ?? '').trim().split(/\s+/).filter(Boolean)[0]
  if (cls) return `.${cls}`
  // Без id и классов: последние два звена пути без :nth-of-type — `section.card > h2` читается и не липнет к позиции.
  const parts = selector.split(' > ').map((p) => p.replace(/:nth-of-type\(\d+\)/g, ''))
  return parts.slice(-2).join(' > ')
}

/** rgb(a) из getComputedStyle → #hex для <input type=color>; прозрачное — пусто. */
export function toHex(value: string | undefined): string {
  if (!value) return ''
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!m) return value.startsWith('#') ? value : ''
  if (m[4] !== undefined && Number(m[4]) === 0) return ''
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}

export function cssRule(selector: string, values: StyleValues): string {
  const lines = (Object.entries(values) as Array<[StyleProp, string]>).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v};`)
  return `${selector} {\n${lines.join('\n')}\n}\n`
}

export function MakeStylePanel({ selector, id, className, computed, onPreview, onWrite, onReset }: MakeStylePanelProps): JSX.Element {
  const [rule, setRule] = useState(() => shortSelector(selector, id, className))
  const [values, setValues] = useState<StyleValues>({})
  const [writing, setWriting] = useState(false)
  useEffect(() => { setRule(shortSelector(selector, id, className)); setValues({}) }, [selector, id, className])
  const set = (prop: StyleProp, value: string): void => {
    const next = { ...values, [prop]: value }
    setValues(next)
    onPreview(next)
  }
  const current = (prop: StyleProp): string => values[prop] ?? computed[prop] ?? ''
  const dirty = Object.values(values).some(Boolean)
  return (
    <div className="make-style" data-testid="make-style">
      <div className="make-style-grid">
        <label className="make-style-field"><span>Селектор</span><input type="text" value={rule} onChange={(e) => setRule(e.target.value)} aria-label="Селектор правила" /></label>
        <label className="make-style-field"><span>Цвет</span><span className="make-style-color"><input type="color" value={toHex(current('color')) || '#000000'} onChange={(e) => set('color', e.target.value)} aria-label="Цвет текста" /><code>{current('color')}</code></span></label>
        <label className="make-style-field"><span>Фон</span><span className="make-style-color"><input type="color" value={toHex(current('background-color')) || '#ffffff'} onChange={(e) => set('background-color', e.target.value)} aria-label="Цвет фона" /><code>{current('background-color') || '—'}</code></span></label>
        <label className="make-style-field"><span>Размер шрифта</span><input type="text" value={current('font-size')} onChange={(e) => set('font-size', e.target.value)} aria-label="Размер шрифта" placeholder="16px" /></label>
        <label className="make-style-field"><span>Насыщенность</span>
          <select value={current('font-weight')} onChange={(e) => set('font-weight', e.target.value)} aria-label="Насыщенность шрифта">
            {['', '300', '400', '500', '600', '700', '800'].map((w) => <option key={w} value={w}>{w || '—'}</option>)}
          </select>
        </label>
        <label className="make-style-field"><span>Выравнивание</span>
          <select value={current('text-align')} onChange={(e) => set('text-align', e.target.value)} aria-label="Выравнивание текста">
            {['', 'left', 'center', 'right', 'justify'].map((a) => <option key={a} value={a}>{a || '—'}</option>)}
          </select>
        </label>
        <label className="make-style-field"><span>Отступ внутри</span><input type="text" value={current('padding')} onChange={(e) => set('padding', e.target.value)} aria-label="Внутренний отступ" placeholder="8px 12px" /></label>
        <label className="make-style-field"><span>Отступ снаружи</span><input type="text" value={current('margin')} onChange={(e) => set('margin', e.target.value)} aria-label="Внешний отступ" placeholder="0" /></label>
        <label className="make-style-field"><span>Скругление</span><input type="text" value={current('border-radius')} onChange={(e) => set('border-radius', e.target.value)} aria-label="Скругление углов" placeholder="8px" /></label>
      </div>
      <div className="make-style-actions">
        <Button size="sm" variant="primary" disabled={!dirty || !rule.trim()} loading={writing} onClick={async () => { setWriting(true); try { await onWrite(rule.trim(), values); setValues({}) } finally { setWriting(false) } }}>Записать в CSS</Button>
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => { setValues({}); onReset() }}>Сбросить</Button>
      </div>
    </div>
  )
}
