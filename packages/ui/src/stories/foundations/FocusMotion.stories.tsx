import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Button, Dialog, Skeleton } from '@voicechat/ui-kit'

function FocusMotion(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)
  return <section style={{ maxWidth: 640, padding: 16 }}>
    <h1>Фокус и движение</h1>
    <p>Tab и Shift+Tab перемещают фокус. Откройте окно, пройдите его по кругу и нажмите Escape: фокус вернётся на кнопку.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      <Button onClick={() => setOpen(true)}>Проверить окно</Button>
      <label>Название <input /></label>
      <a href="#focus-motion-description">Перейти к описанию</a>
    </div>
    <p id="focus-motion-description">При включённом системном уменьшении движения скелетон и появление окна неподвижны.</p>
    <Skeleton variant="list" count={3} />
    {open && <Dialog title="Проверка фокуса" onClose={() => setOpen(false)} padded>
      <label>Первое поле <input /></label>
      <Button onClick={() => setEnabled(!enabled)} aria-pressed={enabled}>Переключить состояние</Button>
      <Button onClick={() => setOpen(false)}>Готово</Button>
    </Dialog>}
  </section>
}
const meta: Meta<typeof FocusMotion> = { title: 'Foundations/Фокус и движение', component: FocusMotion }
export default meta
type Story = StoryObj<typeof FocusMotion>
export const KeyboardAndMotion: Story = {}
