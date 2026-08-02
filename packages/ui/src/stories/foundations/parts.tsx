// Общая обвязка витрины Foundations: заголовки разделов, таблицы, образцы цвета
// и отметка WCAG. Вынесено из сториз, чтобы пять страниц выглядели одинаково и
// правились в одном месте. Всё рисуется на токенах — витрина обязана жить по
// тем же правилам, что и приложение.
import type { CSSProperties, ReactNode } from 'react'
import type { Rgb, ThemeName, WcagLevel } from './tokens'
import { contrastRatio, fmtRatio, wcagLevel } from './tokens'

export const PAGE: CSSProperties = { display: 'grid', gap: 22, color: 'var(--text)', maxWidth: 1080 }
export const TABLE: CSSProperties = { borderCollapse: 'collapse', fontSize: 12, width: '100%' }
export const TH: CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  color: 'var(--text-dim)',
  fontWeight: 600,
  padding: '6px 10px',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap'
}
export const TD: CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--border-soft)', verticalAlign: 'middle' }
export const MONO: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }

/** Страница витрины: заголовок, подводка и содержимое. */
export function Page({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div style={PAGE}>
      <header style={{ display: 'grid', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.2px' }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', maxWidth: 760 }}>{lead}</p>
      </header>
      {children}
    </div>
  )
}

/** Раздел страницы с подзаголовком и необязательной подсказкой. */
export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{title}</h3>
      {hint && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)', maxWidth: 760 }}>{hint}</p>}
      {children}
    </section>
  )
}

/** Половина страницы в конкретной теме: фон и текст берутся из её токенов. */
export function ThemePane({ theme, children }: { theme: ThemeName; children: ReactNode }): JSX.Element {
  return (
    <div
      data-theme={theme}
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        display: 'grid',
        gap: 10,
        minWidth: 0
      }}
    >
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-dim)', fontWeight: 600 }}>
        {theme === 'light' ? 'светлая тема' : 'тёмная тема'}
      </span>
      {children}
    </div>
  )
}

/** Образец цвета: квадрат с рамкой, чтобы белое на белом тоже было видно. */
export function Swatch({ value, size = 26 }: { value: string; size?: number }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size * 1.6,
        height: size,
        background: value,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-medium)'
      }}
    />
  )
}

/** Моношрифтом — имена токенов, селекторы и значения. */
export function Mono({ children }: { children: ReactNode }): JSX.Element {
  return <code style={MONO}>{children}</code>
}

/**
 * Порог контраста: обычный текст — 4.5:1 (WCAG 1.4.3), границы элементов
 * интерфейса — 3:1 (1.4.11), декоративные разделители порога не имеют вовсе, и
 * требовать от них 3:1 значило бы кричать «волки» на каждой линейке таблицы.
 * Крупный текст тоже проходит на 3:1, но в интерфейсе почти всё мелкое, поэтому
 * по умолчанию требуем полный AA.
 *
 * Само определение живёт в `tokens.ts` рядом со списком пар: на него смотрит и
 * витрина, и `styles/contrast.test.ts` — второй копии порога быть не должно.
 */
export { AA_THRESHOLD, type ContrastKind } from './tokens'
import { AA_THRESHOLD, type ContrastKind } from './tokens'

export function passesAa(ratio: number, kind: ContrastKind = 'text'): boolean {
  return ratio >= AA_THRESHOLD[kind]
}

const LEVEL_TONE: Record<WcagLevel, string> = {
  AAA: 'success',
  AA: 'success',
  'AA Large': 'progress',
  fail: 'removed'
}

/**
 * Отметка WCAG рядом с коэффициентом. Провал подписан словами («ниже AA»), а не
 * только цветом: витрину доступности стыдно делать нечитаемой для дальтоника.
 */
export function Verdict({ ratio, kind = 'text' }: { ratio: number; kind?: ContrastKind }): JSX.Element {
  const level = wcagLevel(ratio)
  const ok = passesAa(ratio, kind)
  const tone = kind === 'text' ? LEVEL_TONE[level] : kind === 'decor' ? 'neutral' : ok ? 'success' : 'removed'
  const label = kind === 'decor' ? 'справочно' : ok ? (kind === 'ui' ? 'AA (3:1)' : level) : kind === 'ui' ? 'ниже 3:1' : 'ниже AA'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={MONO}>{fmtRatio(ratio)}</span>
      <span className={`ci-lozenge ci-lozenge--${tone}`}>{label}</span>
    </span>
  )
}

/** «—» вместо цифры там, где контраст не считается (отступы, радиусы). */
export function Dash(): JSX.Element {
  return <span style={{ color: 'var(--text-dim)' }}>—</span>
}

/** Контраст пары или null, если один из цветов не разобрался. */
export function ratioOf(fg: Rgb | null, bg: Rgb | null): number | null {
  return fg && bg ? contrastRatio(fg, bg) : null
}
