// Матрица кнопки: вариант × размер × состояние — и сразу в двух темах рядом.
// Тёмная половина рисуется своим data-theme внутри сториз, чтобы расхождение
// («в тёмной подпись выцвела») было видно без переключения тулбара.
//
// hover и focus-visible показываем крючками .is-hover/.is-focus: в app.css они
// стоят в тех же правилах, что и сами псевдоклассы, поэтому матрица не может
// разойтись с боевым видом.
import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Button, type ButtonSize, type ButtonVariant } from './Button'
import { IconButton } from './IconButton'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'fullscreen' }
}
export default meta
type Story = StoryObj<typeof Button>

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger']
const SIZES: ButtonSize[] = ['md', 'sm']
const STATES: Array<{ label: string; props: Record<string, unknown> }> = [
  { label: 'обычная', props: {} },
  { label: 'hover', props: { className: 'is-hover' } },
  { label: 'focus-visible', props: { className: 'is-focus' } },
  { label: 'disabled', props: { disabled: true } },
  { label: 'loading', props: { loading: true } }
]

const HEAD: CSSProperties = { textAlign: 'left', fontSize: 12, opacity: 0.7, fontWeight: 600, padding: '6px 10px' }
const CELL: CSSProperties = { padding: '6px 10px' }

/** Одна тема целиком: строки — вариант × размер, столбцы — состояния. */
function Matrix({ theme }: { theme: 'light' | 'dark' }): JSX.Element {
  return (
    <div
      data-theme={theme}
      style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 10, minWidth: 0, overflowX: 'auto' }}
    >
      <h3 style={{ margin: '0 0 10px', fontSize: 13 }}>{theme === 'light' ? 'Светлая тема' : 'Тёмная тема'}</h3>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={HEAD}>вариант / размер</th>
            {STATES.map((state) => (
              <th key={state.label} style={HEAD}>
                {state.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VARIANTS.flatMap((variant) =>
            SIZES.map((size) => (
              <tr key={`${variant}-${size}`}>
                <td style={{ ...HEAD, whiteSpace: 'nowrap' }}>
                  {variant} · {size}
                </td>
                {STATES.map((state) => (
                  <td key={state.label} style={CELL}>
                    <Button variant={variant} size={size} iconLeft="✓" {...state.props}>
                      Сохранить
                    </Button>
                  </td>
                ))}
              </tr>
            ))
          )}
          <tr>
            <td style={{ ...HEAD, whiteSpace: 'nowrap' }}>IconButton · md/sm</td>
            {STATES.map((state) => (
              <td key={state.label} style={CELL}>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <IconButton aria-label="Закрыть" title="Закрыть" {...state.props}>
                    ✕
                  </IconButton>
                  <IconButton aria-label="Закрыть" title="Закрыть" size="sm" {...state.props}>
                    ✕
                  </IconButton>
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Полная матрица в обеих темах — основной экран сверки. */
export const Matrices: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      <Matrix theme="light" />
      <Matrix theme="dark" />
    </div>
  )
}

/** Иконки, растянутая кнопка и круглые кнопки композера. */
export const Shapes: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 14, maxWidth: 340 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary" iconLeft="＋">
          Слева иконка
        </Button>
        <Button iconRight="→">Справа иконка</Button>
        <Button variant="ghost" size="sm" iconLeft="⇅">
          ghost sm
        </Button>
      </div>
      <Button variant="primary" fullWidth loading>
        Сохранение…
      </Button>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <IconButton className="vc-btn--danger-quiet" aria-label="Удалить" title="Удалить">
          ✕
        </IconButton>
        <span className="fsub">тихий danger: краснеет под курсором</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <IconButton className="vc-btn--circle" variant="secondary" size="sm" aria-label="Прикрепить" title="Прикрепить">
          📎
        </IconButton>
        <IconButton className="vc-btn--circle" variant="primary" aria-label="Говорить" title="Говорить">
          🎙
        </IconButton>
        <IconButton className="vc-btn--circle" variant="danger" aria-label="Остановить" title="Остановить">
          ■
        </IconButton>
      </div>
    </div>
  )
}
