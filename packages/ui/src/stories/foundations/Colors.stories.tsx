// Палитра: все токены обеих тем и контраст семантических пар «текст на фоне».
// Значения не выписаны в TS — они читаются из app.css в момент показа, поэтому
// таблица не может разойтись со стилями, а цифры контраста не устаревают.
import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { AA_THRESHOLD, Dash, Mono, Page, Section, Swatch, TABLE, TD, TH, Verdict, ratioOf, type ContrastKind } from './parts'
import { CONTRAST_PAIRS, readTokens, resolveColor, type Rgb, type ThemeName, type Token } from './tokens'

const meta: Meta = {
  title: 'Foundations/Colors',
  parameters: { layout: 'padded' }
}
export default meta
type Story = StoryObj

/** Токены читаются из подключённых стилей, поэтому только после монтирования. */
function useTokens(): Token[] | null {
  const [tokens, setTokens] = useState<Token[] | null>(null)
  useEffect(() => {
    setTokens(readTokens())
  }, [])
  return tokens
}

function Loading(): JSX.Element {
  return <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Читаем токены из app.css…</p>
}

/** Цвет токена в конкретной теме — для расчёта контраста. */
function rgb(tokens: Token[], name: string, theme: ThemeName): Rgb | null {
  const token = tokens.find((t) => t.name === name)
  if (!token) return null
  return resolveColor(theme === 'light' ? token.light : token.dark, theme)
}

/** Значение токена в теме — для образца и подписи. */
function value(tokens: Token[], name: string, theme: ThemeName): string {
  const token = tokens.find((t) => t.name === name)
  if (!token) return ''
  return theme === 'light' ? token.light : token.dark
}

/** Пары — из tokens.ts: тот же список гейтит styles/contrast.test.ts. */
const PAIRS = CONTRAST_PAIRS


const THEMES: ThemeName[] = ['light', 'dark']

/** Все токены: имя, образец и вычисленное значение в каждой теме. */
export const AllTokens: Story = {
  name: 'Все токены',
  render: () => {
    const tokens = useTokens()
    return (
      <Page
        title="Colors — токены палитры"
        lead={
          <>
            Имена собраны из правил <Mono>:root</Mono> и <Mono>[data-theme=&apos;dark&apos;]</Mono> в <Mono>styles/app.css</Mono>,
            значения сняты с зондов через <Mono>getComputedStyle</Mono>. Новый токен появляется здесь сам — дублировать палитру в TS
            нельзя.
          </>
        }
      >
        {!tokens ? (
          <Loading />
        ) : (
          <Section
            title={`Все токены (${tokens.length})`}
            hint={
              <>
                Токены без отметки «своё значение» тёмная тема наследует у <Mono>:root</Mono> — это нормально для геометрии
                (<Mono>--space-*</Mono>, <Mono>--radius-medium</Mono>) и подозрительно для цвета.
              </>
            }
          >
            <table style={TABLE}>
              <thead>
                <tr>
                  <th style={TH} scope="col">
                    токен
                  </th>
                  <th style={TH} scope="col">
                    светлая
                  </th>
                  <th style={TH} scope="col">
                    значение
                  </th>
                  <th style={TH} scope="col">
                    тёмная
                  </th>
                  <th style={TH} scope="col">
                    значение
                  </th>
                  <th style={TH} scope="col">
                    в тёмной теме
                  </th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.name}>
                    <th style={{ ...TD, ...TH, borderBottom: '1px solid var(--border-soft)', color: 'var(--text)', textTransform: 'none' }} scope="row">
                      <Mono>{token.name}</Mono>
                    </th>
                    <td style={TD} data-theme="light">
                      {token.isColor ? <Swatch value={token.light} /> : <Ruler value={token.light} />}
                    </td>
                    <td style={TD}>
                      <Mono>{token.light}</Mono>
                    </td>
                    <td style={{ ...TD, background: 'var(--bg)' }} data-theme="dark">
                      {token.isColor ? <Swatch value={token.dark} /> : <Ruler value={token.dark} />}
                    </td>
                    <td style={TD}>
                      <Mono>{token.dark}</Mono>
                    </td>
                    <td style={{ ...TD, fontSize: 11, color: 'var(--text-dim)' }}>
                      {token.darkOverride ? 'своё значение' : 'наследует светлое'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
      </Page>
    )
  }
}

/** Нецветной токен показываем линейкой — так видно, что 4px это мало. */
function Ruler({ value: length }: { value: string }): JSX.Element {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: length, height: 12, background: 'var(--accent)', borderRadius: 2 }} />
}

/** Контраст пар: цифра, вердикт и живой образец в обеих темах. */
export const Contrast: Story = {
  name: 'Контраст пар',
  render: () => {
    const tokens = useTokens()
    if (!tokens) return <Loading />
    const failing = THEMES.flatMap((theme) =>
      PAIRS.filter((pair) => {
        const ratio = ratioOf(rgb(tokens, pair.fg, theme), rgb(tokens, pair.bg, theme))
        return ratio != null && ratio < AA_THRESHOLD[pair.kind ?? 'text']
      }).map((pair) => `${pair.fg} на ${pair.bg} (${theme === 'light' ? 'светлая' : 'тёмная'})`)
    )
    return (
      <Page
        title="Colors — контраст пар"
        lead={
          <>
            Коэффициенты считаются здесь же по формуле WCAG 2.1 из вычисленных значений токенов. Порог: текст — 4.5:1 (1.4.3),
            границы элементов интерфейса — 3:1 (1.4.11), декоративные разделители показаны справочно.
          </>
        }
      >
        <Section
          title="Что не проходит AA"
          hint="Список собирается из таблицы ниже — если он пуст, все пары в норме; если нет, правь токен, а не отдельное правило."
        >
          {failing.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13 }}>
              <span className="ci-lozenge ci-lozenge--success">все пары проходят</span>
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: 'grid', gap: 4 }}>
              {failing.map((item) => (
                <li key={item}>
                  <span className="ci-lozenge ci-lozenge--removed">ниже AA</span> <Mono>{item}</Mono>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Пары целиком">
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH} scope="col">
                  пара
                </th>
                <th style={TH} scope="col">
                  где применяется
                </th>
                {THEMES.map((theme) => (
                  <th style={TH} scope="col" key={theme}>
                    {theme === 'light' ? 'светлая' : 'тёмная'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PAIRS.map((pair) => (
                <tr key={`${pair.fg}-${pair.bg}-${pair.kind ?? 'text'}`}>
                  <th style={{ ...TD, textAlign: 'left', fontWeight: 400 }} scope="row">
                    <Mono>{pair.fg}</Mono>
                    <span style={{ color: 'var(--text-dim)' }}> на </span>
                    <Mono>{pair.bg}</Mono>
                  </th>
                  <td style={{ ...TD, color: 'var(--text-dim)' }}>{pair.usage}</td>
                  {THEMES.map((theme) => {
                    const ratio = ratioOf(rgb(tokens, pair.fg, theme), rgb(tokens, pair.bg, theme))
                    return (
                      <td style={{ ...TD, background: 'var(--bg)' }} data-theme={theme} key={theme}>
                        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <Sample fg={value(tokens, pair.fg, theme)} bg={value(tokens, pair.bg, theme)} kind={pair.kind} />
                          {ratio == null ? <Dash /> : <Verdict ratio={ratio} kind={pair.kind} />}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </Page>
    )
  }
}

/** Живой образец пары: текст на фоне, для 'ui' — рамка, для 'decor' — линия разделителя. */
function Sample({ fg, bg, kind }: { fg: string; bg: string; kind?: ContrastKind }): JSX.Element {
  if (kind === 'decor')
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', width: 84, height: 20, background: bg, borderRadius: 'var(--radius-medium)' }}>
        <span style={{ display: 'block', width: '100%', height: 1, background: fg }} />
      </span>
    )
  if (kind === 'ui')
    return (
      <span style={{ display: 'inline-block', width: 84, height: 20, background: bg, border: `2px solid ${fg}`, borderRadius: 'var(--radius-medium)' }} />
    )
  return (
    <span style={{ background: bg, color: fg, padding: '2px 8px', borderRadius: 'var(--radius-medium)', fontSize: 12, fontWeight: 600 }}>
      Текст 12px
    </span>
  )
}
