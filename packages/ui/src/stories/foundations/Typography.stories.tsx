// Типографика: кегли, веса и семейства, которые реально встречаются в app.css.
// Список собирается обходом правил, поэтому «лишний» 12.5px, добавленный под
// один экран, сразу видно в витрине — вместе с селектором-виновником.
import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Mono, Page, Section, TABLE, TD, TH } from './parts'
import { fontFamilies, fontSizes, fontWeights, type ScaleEntry } from './typeScale'

const meta: Meta = {
  title: 'Foundations/Typography',
  parameters: { layout: 'padded' }
}
export default meta
type Story = StoryObj

interface Scan {
  sizes: ScaleEntry[]
  weights: ScaleEntry[]
  families: ScaleEntry[]
  bodyFont: string
}

function useScan(): Scan | null {
  const [scan, setScan] = useState<Scan | null>(null)
  useEffect(() => {
    setScan({
      sizes: fontSizes(),
      weights: fontWeights(),
      families: fontFamilies(),
      bodyFont: getComputedStyle(document.body).fontFamily
    })
  }, [])
  return scan
}

/** Рекомендация по кеглю: что этим размером набирают и когда его брать. */
const SIZE_ADVICE: Record<string, string> = {
  '24px': 'крупный числовой акцент (счётчик на экране логина) — больше нигде',
  '22px': 'заголовок пустого экрана и большая цифра статистики',
  '20px': 'заголовок страницы или модального окна',
  '18px': 'подзаголовок раздела — редкий, можно свести к 16px',
  '17px': 'единичный случай — приводить к 16px',
  '16px': 'логотип, заголовок окна, крупная подпись в шапке',
  '15px': 'текст сообщения в чате — самый читаемый размер контента',
  '14px': 'заголовок блока настроек, подзаголовок карточки',
  '13.5px': 'единичный случай — приводить к 13px',
  '13px': 'основной размер интерфейса: пункты списков, поля, кнопки',
  '12.5px': 'единичный случай — приводить к 12px или 13px',
  '12px': 'плотные таблицы, вторичные подписи, содержимое консолей',
  '11px': 'лозенги, мета под заголовком, подписи иконок — минимум для текста',
  '10px': 'счётчики и индексы поверх иконок; для текста уже мелко'
}

/** Рекомендация по весу. 750 — след прототипа, отдельного смысла не несёт. */
const WEIGHT_ADVICE: Record<string, string> = {
  '800': 'логотип и заголовок пустого экрана',
  '750': 'след прототипа — приводить к 700',
  '700': 'заголовки карточек, названия задач, акценты в строке',
  '600': 'рабочий полужирный: кнопки, лозенги, шапки таблиц',
  '500': 'редкий средний вес — обычно заменяется на 600',
  '400': 'обычный текст (сброс жирности внутри заголовков)'
}

const ODD = new Set(['12.5px', '13.5px', '17px', '750'])

export const Scale: Story = {
  name: 'Шкала',
  render: () => {
    const scan = useScan()
    if (!scan) return <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>Читаем правила из app.css…</p>
    return (
      <Page
        title="Typography"
        lead={
          <>
            Отдельных токенов у шрифта нет: кегль и вес стоят прямо в правилах <Mono>styles/app.css</Mono>. Таблицы ниже собраны
            обходом подключённых стилей — счётчик показывает, насколько размер прижился, а помеченные «привести к шкале» значения
            стоит вычистить, а не размножать.
          </>
        }
      >
        <Section title="Семейства" hint={<>Интерфейсный шрифт приходит из <Mono>global.css</Mono> (<Mono>body</Mono>), моно — из правил кода и консолей.</>}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <Mono>body</Mono> → <Mono>{scan.bodyFont}</Mono>
          </p>
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH} scope="col">
                  семейство
                </th>
                <th style={TH} scope="col">
                  правил
                </th>
                <th style={TH} scope="col">
                  образец
                </th>
              </tr>
            </thead>
            <tbody>
              {scan.families.map((family) => (
                <tr key={family.value}>
                  <th style={{ ...TD, textAlign: 'left', fontWeight: 400 }} scope="row">
                    <Mono>{family.value}</Mono>
                  </th>
                  <td style={TD}>{family.count}</td>
                  <td style={{ ...TD, fontFamily: family.value, fontSize: 13 }}>Голос чата — 0123456789</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`Кегли (${scan.sizes.length})`}>
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH} scope="col">
                  размер
                </th>
                <th style={TH} scope="col">
                  образец
                </th>
                <th style={TH} scope="col">
                  правил
                </th>
                <th style={TH} scope="col">
                  для чего
                </th>
                <th style={TH} scope="col">
                  примеры селекторов
                </th>
              </tr>
            </thead>
            <tbody>
              {scan.sizes.map((size) => (
                <tr key={size.value}>
                  <th style={{ ...TD, textAlign: 'left', fontWeight: 400, whiteSpace: 'nowrap' }} scope="row">
                    <Mono>{size.value}</Mono>
                    {ODD.has(size.value) && <span className="ci-lozenge ci-lozenge--progress" style={{ marginLeft: 6 }}>привести к шкале</span>}
                  </th>
                  <td style={{ ...TD, fontSize: size.value }}>Живой пример текста</td>
                  <td style={TD}>{size.count}</td>
                  <td style={{ ...TD, color: 'var(--text-dim)' }}>{SIZE_ADVICE[size.value] ?? 'нет рекомендации — проверь, нужен ли размер'}</td>
                  <td style={{ ...TD, color: 'var(--text-dim)' }}>
                    <Mono>{size.selectors.join(', ')}</Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={`Веса (${scan.weights.length})`}>
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH} scope="col">
                  вес
                </th>
                <th style={TH} scope="col">
                  образец
                </th>
                <th style={TH} scope="col">
                  правил
                </th>
                <th style={TH} scope="col">
                  для чего
                </th>
                <th style={TH} scope="col">
                  примеры селекторов
                </th>
              </tr>
            </thead>
            <tbody>
              {scan.weights.map((weight) => (
                <tr key={weight.value}>
                  <th style={{ ...TD, textAlign: 'left', fontWeight: 400, whiteSpace: 'nowrap' }} scope="row">
                    <Mono>{weight.value}</Mono>
                    {ODD.has(weight.value) && <span className="ci-lozenge ci-lozenge--progress" style={{ marginLeft: 6 }}>привести к шкале</span>}
                  </th>
                  <td style={{ ...TD, fontWeight: Number(weight.value), fontSize: 15 }}>Голос чата</td>
                  <td style={TD}>{weight.count}</td>
                  <td style={{ ...TD, color: 'var(--text-dim)' }}>{WEIGHT_ADVICE[weight.value] ?? 'нет рекомендации — проверь, нужен ли вес'}</td>
                  <td style={{ ...TD, color: 'var(--text-dim)' }}>
                    <Mono>{weight.selectors.join(', ')}</Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </Page>
    )
  }
}

/** Как размеры складываются в реальный блок: заголовок → текст → мета. */
export const InUse: Story = {
  name: 'В деле',
  render: () => (
    <Page title="Typography — иерархия" lead="Три уровня подряд: заголовок 20px/800, содержимое 15px/400, мета 11px/600 приглушённым цветом.">
      <Section title="Экран">
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-medium)',
            padding: 'var(--space-150)',
            display: 'grid',
            gap: 'var(--space-100)',
            maxWidth: 520
          }}
        >
          <h4 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.2px' }}>Заголовок окна</h4>
          <p style={{ margin: 0, fontSize: 15 }}>
            Текст сообщения набирается 15px — это единственное место, где размер выбран под чтение, а не под плотность.
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>Интерфейсный размер 13px: пункты списков, подписи полей, кнопки.</p>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-dim)' }}>
            мета · 11px · 600
          </span>
        </div>
      </Section>
    </Page>
  )
}
