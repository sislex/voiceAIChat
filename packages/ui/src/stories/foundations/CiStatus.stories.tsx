// Статусы CI-рана: бейджи на своих токенах в обеих темах и рядом — источник
// правды. Подписи, иконки и группу токенов даёт ciFormat.ts, список статусов —
// CI_STATUSES из @shared/ci, поэтому новый статус попадает в витрину сам и сразу
// видно, что он окрашен «нейтрально по умолчанию», а тон ему не подобрали.
import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { CI_STATUSES, type CiStatus } from '@shared/ci'
import { ciStatusIcon, ciStatusLabel, ciTone, type CiTone } from '../../components/ci/ciFormat'
import { Dash, Mono, Page, Section, TABLE, TD, TH, ThemePane, Verdict, ratioOf } from './parts'
import { readTokens, resolveColor, type ThemeName, type Token } from './tokens'

const meta: Meta = {
  title: 'Foundations/CI Status',
  parameters: { layout: 'padded' }
}
export default meta
type Story = StoryObj

const THEMES: ThemeName[] = ['light', 'dark']

/** Пара токенов лозенга: текст и подложка. Имена собраны по правилу .ci-lozenge--<тон>. */
function tonePair(tone: CiTone): { fg: string; bg: string } {
  return { fg: `--ci-${tone}`, bg: `--ci-${tone}-bg` }
}

/** Что означает тон и какие статусы в него попадают. */
const TONE_MEANING: Record<CiTone, string> = {
  neutral: 'ничего не происходит: ран ждёт слот или шаг пропущен',
  progress: 'ран занят: идёт шаг или модель ждёт ответа человека',
  success: 'ран закончился успехом',
  removed: 'ран закончился неудачей: ошибка, таймаут или отмена'
}

function Lozenge({ status }: { status: CiStatus }): JSX.Element {
  return (
    <span className={`ci-lozenge ci-lozenge--${ciTone(status)}`}>
      <span aria-hidden="true">{ciStatusIcon(status)}</span>
      {ciStatusLabel(status)}
    </span>
  )
}

/** Бейджи всех статусов в обеих темах. */
export const Badges: Story = {
  name: 'Бейджи',
  render: () => (
    <Page
      title="CI Status"
      lead={
        <>
          Лозенг рисуется классом <Mono>.ci-lozenge--&lt;тон&gt;</Mono>, тон статусу выдаёт <Mono>ciTone()</Mono>. Своих цветов у
          статуса нет — только четыре пары токенов <Mono>--ci-*</Mono> / <Mono>--ci-*-bg</Mono>.
        </>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--space-150)' }}>
        {THEMES.map((theme) => (
          <ThemePane theme={theme} key={theme}>
            <div style={{ display: 'flex', gap: 'var(--space-150)', flexWrap: 'wrap', alignItems: 'center' }}>
              {CI_STATUSES.map((status) => (
                <span key={status} style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
                  <Lozenge status={status} />
                  <Mono>{status}</Mono>
                </span>
              ))}
            </div>
          </ThemePane>
        ))}
      </div>

      <Section title="Тон и его смысл">
        <table style={TABLE}>
          <thead>
            <tr>
              <th style={TH} scope="col">
                тон
              </th>
              <th style={TH} scope="col">
                токены
              </th>
              <th style={TH} scope="col">
                статусы
              </th>
              <th style={TH} scope="col">
                когда
              </th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(TONE_MEANING) as CiTone[]).map((tone) => {
              const pair = tonePair(tone)
              return (
                <tr key={tone}>
                  <th style={{ ...TD, textAlign: 'left', fontWeight: 400 }} scope="row">
                    <span className={`ci-lozenge ci-lozenge--${tone}`}>{tone}</span>
                  </th>
                  <td style={TD}>
                    <Mono>
                      {pair.fg} / {pair.bg}
                    </Mono>
                  </td>
                  <td style={TD}>
                    <Mono>{CI_STATUSES.filter((status) => ciTone(status) === tone).join(', ') || '—'}</Mono>
                  </td>
                  <td style={{ ...TD, color: 'var(--text-dim)' }}>{TONE_MEANING[tone]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>
    </Page>
  )
}

/** Источник правды: что именно возвращает ciFormat.ts для каждого статуса. */
export const SourceOfTruth: Story = {
  name: 'Источник правды',
  render: () => {
    const [tokens, setTokens] = useState<Token[] | null>(null)
    useEffect(() => {
      setTokens(readTokens())
    }, [])
    return (
      <Page
        title="CI Status — источник правды"
        lead={
          <>
            Таблица целиком вычислена: статусы — <Mono>CI_STATUSES</Mono> из <Mono>@shared/ci</Mono>, подпись и глиф —{' '}
            <Mono>ciStatusLabel()</Mono> и <Mono>ciStatusIcon()</Mono>, тон — <Mono>ciTone()</Mono> из{' '}
            <Mono>components/ci/ciFormat.ts</Mono>. Контраст лозенга считается по вычисленным токенам: подпись в нём 11px, значит
            нужен полный AA 4.5:1.
          </>
        }
      >
        <table style={TABLE}>
          <thead>
            <tr>
              <th style={TH} scope="col">
                статус
              </th>
              <th style={TH} scope="col">
                подпись
              </th>
              <th style={TH} scope="col">
                глиф
              </th>
              <th style={TH} scope="col">
                тон
              </th>
              {THEMES.map((theme) => (
                <th style={TH} scope="col" key={theme}>
                  {theme === 'light' ? 'светлая' : 'тёмная'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CI_STATUSES.map((status) => {
              const tone = ciTone(status)
              const pair = tonePair(tone)
              return (
                <tr key={status}>
                  <th style={{ ...TD, textAlign: 'left', fontWeight: 400 }} scope="row">
                    <Mono>{status}</Mono>
                  </th>
                  <td style={TD}>{ciStatusLabel(status)}</td>
                  <td style={{ ...TD, textAlign: 'center' }}>{ciStatusIcon(status)}</td>
                  <td style={TD}>
                    <Mono>{tone}</Mono>
                  </td>
                  {THEMES.map((theme) => {
                    const ratio = tokens
                      ? ratioOf(tokenRgb(tokens, pair.fg, theme), tokenRgb(tokens, pair.bg, theme))
                      : null
                    return (
                      <td style={{ ...TD, background: 'var(--bg)' }} data-theme={theme} key={theme}>
                        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <Lozenge status={status} />
                          {ratio == null ? <Dash /> : <Verdict ratio={ratio} />}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Page>
    )
  }
}

/** Цвет токена в теме — для расчёта контраста лозенга. */
function tokenRgb(tokens: Token[], name: string, theme: ThemeName): ReturnType<typeof resolveColor> {
  const token = tokens.find((t) => t.name === name)
  if (!token) return null
  return resolveColor(theme === 'light' ? token.light : token.dark, theme)
}
