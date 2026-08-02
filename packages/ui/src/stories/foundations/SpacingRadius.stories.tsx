// Геометрия: три шага отступов и единственный радиус. Значения снова читаются из
// app.css, а «где применяется» собирается обходом правил — так видно, что
// --space-150 живёт в паддингах блоков, а не в зазорах между иконками.
import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '../../components/ui/Button'
import { Mono, Page, Section, TABLE, TD, TH } from './parts'
import { readTokens, varUsage, type Token } from './tokens'

const meta: Meta = {
  title: 'Foundations/Spacing & Radius',
  parameters: { layout: 'padded' }
}
export default meta
type Story = StoryObj

interface GeometryToken extends Token {
  usage: { count: number; selectors: string[] }
}

/** Токены геометрии со статистикой применения — читаются после монтирования. */
function useGeometry(): GeometryToken[] | null {
  const [rows, setRows] = useState<GeometryToken[] | null>(null)
  useEffect(() => {
    setRows(
      readTokens()
        .filter((token) => token.name.startsWith('--space') || token.name.startsWith('--radius'))
        .map((token) => ({ ...token, usage: varUsage(token.name) }))
    )
  }, [])
  return rows
}

/** Зачем каждый шаг: правило, по которому выбирают токен, а не «на глаз». */
const PURPOSE: Record<string, string> = {
  '--space-050': 'зазор внутри строки: иконка и подпись, лозенг и текст, ячейки лозенгов',
  '--space-100': 'шаг между соседними элементами: кнопки в ряд, поля формы, элементы шапки',
  '--space-150': 'внутренний отступ блока: паддинг кнопки, карточки, панели',
  '--radius-medium': 'скругление всего, что похоже на плашку: кнопка, поле, карточка, лозенг'
}

export const Scale: Story = {
  name: 'Шкала',
  render: () => {
    const rows = useGeometry()
    return (
      <Page
        title="Spacing & Radius"
        lead={
          <>
            Шкала намеренно короткая: три отступа и один радиус. Нужен четвёртый шаг — сначала проверь, не подходит ли
            существующий; новый токен добавляется в <Mono>:root</Mono> и в тёмную тему сразу.
          </>
        }
      >
        {!rows ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Читаем токены из app.css…</p>
        ) : (
          <>
            <Section title="Линейки" hint="Ширина полосы равна значению токена — масштаб настоящий, без коэффициентов.">
              <div style={{ display: 'grid', gap: 10 }}>
                {rows.map((token) => (
                  <div key={token.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Mono>{token.name}</Mono>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: token.light,
                        height: 16,
                        background: 'var(--accent)',
                        borderRadius: token.name.startsWith('--radius') ? token.light : 2
                      }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{token.light}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Что для чего">
              <table style={TABLE}>
                <thead>
                  <tr>
                    <th style={TH} scope="col">
                      токен
                    </th>
                    <th style={TH} scope="col">
                      значение
                    </th>
                    <th style={TH} scope="col">
                      применение
                    </th>
                    <th style={TH} scope="col">
                      правил в app.css
                    </th>
                    <th style={TH} scope="col">
                      примеры селекторов
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((token) => (
                    <tr key={token.name}>
                      <th style={{ ...TD, textAlign: 'left', fontWeight: 400 }} scope="row">
                        <Mono>{token.name}</Mono>
                      </th>
                      <td style={TD}>
                        <Mono>{token.light}</Mono>
                      </td>
                      <td style={{ ...TD, color: 'var(--text-dim)' }}>{PURPOSE[token.name] ?? '—'}</td>
                      <td style={TD}>{token.usage.count}</td>
                      <td style={{ ...TD, color: 'var(--text-dim)' }}>
                        <Mono>{token.usage.selectors.join(', ') || '—'}</Mono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </>
        )}
      </Page>
    )
  }
}

/** Примеры применения: ряд кнопок, плашка и вложенные отступы — всё на токенах. */
export const InUse: Story = {
  name: 'В деле',
  render: () => (
    <Page
      title="Spacing & Radius — примеры"
      lead="Слева живая разметка на токенах, справка — какой шаг за что отвечает. Хардкод пикселей в новых правилах не нужен: он ломает плотность на телефоне."
    >
      <Section title="Ряд кнопок: зазор — --space-100" hint="Одинаковый шаг между кнопками во всём приложении: и в модалке, и в шапке чата.">
        <div style={{ display: 'flex', gap: 'var(--space-100)' }}>
          <Button variant="primary">Сохранить</Button>
          <Button variant="secondary">Отмена</Button>
          <Button variant="ghost">Ещё</Button>
        </div>
      </Section>

      <Section title="Плашка: паддинг --space-150, радиус --radius-medium">
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-medium)',
            padding: 'var(--space-150)',
            display: 'grid',
            gap: 'var(--space-100)',
            maxWidth: 360
          }}
        >
          <strong style={{ fontSize: 13 }}>Карточка</strong>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Заголовок и текст разделены шагом --space-100.</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-050)', fontSize: 12 }}>
            <span className="ci-lozenge ci-lozenge--neutral">лозенг</span>
            подпись через --space-050
          </span>
        </div>
      </Section>

      <Section title="Радиус на разных размерах" hint="Один радиус на всё: кнопка, поле и лозенг выглядят одной семьёй.">
        <div style={{ display: 'flex', gap: 'var(--space-100)', alignItems: 'center', flexWrap: 'wrap' }}>
          {[24, 40, 72].map((size) => (
            <span
              key={size}
              aria-hidden="true"
              style={{
                width: size,
                height: size,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-medium)'
              }}
            />
          ))}
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            круглым остаётся только <Mono>.vc-btn--circle</Mono> — там радиус свой, 50%
          </span>
        </div>
      </Section>
    </Page>
  )
}
