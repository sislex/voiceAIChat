// Сетка всех иконок из components/icons.tsx: превью в текущей теме, три размера
// и копирование имени по клику. Список берётся из экспортов модуля, а не из
// ручного перечня, — новая иконка появляется в витрине сама.
//
// Заодно витрина проверяет правило «цвет — из токенов»: если в SVG прописан
// конкретный цвет вместо currentColor, иконка не переключит тему, и рядом с ней
// появляется отметка с найденным значением.
import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import * as iconModule from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { useToast } from '../../components/ui/Toast'
import { Mono, Page, Section, ThemePane } from './parts'

const meta: Meta = {
  title: 'Foundations/Icons',
  parameters: { layout: 'padded' }
}
export default meta
type Story = StoryObj

type IconComponent = () => JSX.Element

/** Экспорты-иконки модуля по алфавиту. */
const ICONS: Array<[string, IconComponent]> = Object.entries(iconModule as Record<string, IconComponent>)
  .filter(([name]) => name.endsWith('Icon'))
  .sort(([a], [b]) => a.localeCompare(b))

const SIZES = [16, 20, 24] as const

/** Размеры задаём стилем: у SVG прописаны свои width/height, атрибуты не переопределить пропсами. */
const SIZE_CSS = SIZES.map((size) => `.fnd-ic-${size} svg { width: ${size}px; height: ${size}px; }`).join('\n')

/** Жёстко заданные цвета внутри SVG — всё, что не currentColor и не none. */
function hardcodedColors(root: HTMLElement): string[] {
  const found = new Set<string>()
  for (const node of Array.from(root.querySelectorAll('[fill], [stroke]'))) {
    for (const attr of ['fill', 'stroke'] as const) {
      const value = node.getAttribute(attr)
      if (value && value !== 'currentColor' && value !== 'none') found.add(value)
    }
  }
  return [...found]
}

/** Копирование имени: clipboard в iframe Storybook доступен не всегда, поэтому с запасным путём. */
async function copyName(name: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(name)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = name
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/** Карточка иконки: три размера, имя и отметка про жёсткий цвет. */
function IconCard({ name, Icon }: { name: string; Icon: IconComponent }): JSX.Element {
  const toast = useToast()
  const box = useRef<HTMLDivElement>(null)
  const [fixed, setFixed] = useState<string[]>([])
  useEffect(() => {
    if (box.current) setFixed(hardcodedColors(box.current))
  }, [])
  return (
    <Button
      variant="secondary"
      title="Скопировать имя"
      onClick={() => {
        void copyName(name).then((ok) => (ok ? toast.success(`Скопировано: ${name}`) : toast.error('Не удалось скопировать имя')))
      }}
      style={{ display: 'grid', gap: 8, justifyItems: 'center', height: 'auto', padding: 'var(--space-150)', textAlign: 'center' }}
    >
      <span ref={box} style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 12 }} aria-hidden="true">
        {SIZES.map((size) => (
          <span className={`fnd-ic-${size}`} key={size} style={{ display: 'inline-flex' }}>
            <Icon />
          </span>
        ))}
      </span>
      <span style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-dim)' }} aria-hidden="true">
        {SIZES.map((size) => (
          <span key={size} style={{ width: size, textAlign: 'center' }}>
            {size}
          </span>
        ))}
      </span>
      <Mono>{name}</Mono>
      {fixed.length > 0 && (
        <span className="ci-lozenge ci-lozenge--progress" style={{ textTransform: 'none' }}>
          цвет прошит: {fixed.join(', ')}
        </span>
      )}
    </Button>
  )
}

/** Сетка всех иконок в текущей теме тулбара. */
export const Grid: Story = {
  name: 'Сетка',
  render: () => (
    <Page
      title="Icons"
      lead={
        <>
          Все экспорты <Mono>components/icons.tsx</Mono>, чьё имя кончается на <Mono>Icon</Mono>. Клик по карточке копирует имя
          компонента. Иконка должна рисоваться <Mono>currentColor</Mono> — тогда она сама следует теме и варианту кнопки.
        </>
      }
    >
      <style>{SIZE_CSS}</style>
      <Section title={`Иконки (${ICONS.length})`} hint="Размеры 16 / 20 / 24 — те же, что встречаются в шапках, композере и тулбарах.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-150)' }}>
          {ICONS.map(([name, Icon]) => (
            <IconCard name={name} Icon={Icon} key={name} />
          ))}
        </div>
      </Section>
    </Page>
  )
}

/** Иконки внутри кнопок в обеих темах: видно, кто следует currentColor, а кто нет. */
export const OnButtons: Story = {
  name: 'В кнопках',
  render: () => (
    <Page
      title="Icons — в кнопках"
      lead="Иконка на currentColor меняет цвет вместе с вариантом кнопки и темой. Если в обеих темах она осталась одинаково серой — цвет прошит в SVG."
    >
      <style>{SIZE_CSS}</style>
      <div style={{ display: 'grid', gap: 'var(--space-150)' }}>
        {(['light', 'dark'] as const).map((theme) => (
          <ThemePane theme={theme} key={theme}>
            <div style={{ display: 'flex', gap: 'var(--space-100)', flexWrap: 'wrap', alignItems: 'center' }}>
              {ICONS.map(([name, Icon]) => (
                <IconButton variant="ghost" aria-label={name} title={name} key={name}>
                  <span className="fnd-ic-20" style={{ display: 'inline-flex' }}>
                    <Icon />
                  </span>
                </IconButton>
              ))}
              {ICONS.slice(0, 2).map(([name, Icon]) => (
                <Button variant="primary" key={name} iconLeft={<Icon />}>
                  {name}
                </Button>
              ))}
            </div>
          </ThemePane>
        ))}
      </div>
    </Page>
  )
}
