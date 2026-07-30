// Сториз общего окна: размеры, слоты шапки/подвала, вложенность и полный экран
// на телефоне. Мобильный вариант смотрится в отдельном вьюпорте — окно смотрит
// на matchMedia, поэтому важна именно ширина фрейма, а не размер контейнера.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Dialog, type DialogSize } from './Dialog'

const meta: Meta<typeof Dialog> = {
  title: 'UI/Dialog',
  component: Dialog,
  parameters: { layout: 'fullscreen' },
  args: { title: 'Заголовок окна', onClose: () => {} }
}
export default meta
type Story = StoryObj<typeof Dialog>

const PHONE = {
  viewport: {
    viewports: {
      phone: { name: 'Телефон 390×844', styles: { width: '390px', height: '844px' }, type: 'mobile' }
    },
    defaultViewport: 'phone'
  }
}

/** Типовое содержимое: скроллящееся тело обычной формы. */
function Body({ rows = 4 }: { rows?: number }): JSX.Element {
  return (
    <div className="mdbody">
      {Array.from({ length: rows }, (_, i) => (
        <div className="frow" key={i}>
          <div>
            <p className="flab">Настройка {i + 1}</p>
            <p className="fsub">Короткое пояснение, зачем она нужна</p>
          </div>
          <button className="renbtn">Изменить</button>
        </div>
      ))}
    </div>
  )
}

function sized(size: DialogSize): Story {
  return { args: { size }, render: (args) => <Dialog {...args}><Body /></Dialog> }
}

/** sm — короткая форма (онбординг). */
export const Small: Story = sized('sm')
/** md — настройки и подробности запроса. */
export const Medium: Story = sized('md')
/** lg — двухколоночные окна (карточка задачи, AI-помощник). */
export const Large: Story = sized('lg')
/** full — почти весь экран. */
export const Full: Story = sized('full')

/** Слоты шапки и подвала. */
export const WithActionsAndFooter: Story = {
  render: (args) => (
    <Dialog {...args} actions={<button className="renbtn">Действие</button>} footer={<><button className="renbtn">Отмена</button><button className="btn-primary">Сохранить</button></>}>
      <Body rows={2} />
    </Dialog>
  )
}

/** Форма с несохранёнными данными: клик по фону не закрывает, только Esc/крестик. */
export const KeepOpenOnOverlayClick: Story = {
  args: { closeOnOverlay: false },
  render: (args) => <Dialog {...args}><Body rows={2} /></Dialog>
}

/** Вложенность: подтверждение поверх окна получает и Esc, и больший z-index. */
export const Nested: Story = {
  render: (args) => {
    const Demo = (): JSX.Element => {
      const [confirm, setConfirm] = useState(false)
      return (
        <Dialog {...args} title="Карточка задачи" size="lg">
          <div className="mdbody">
            <button className="delbtn" onClick={() => setConfirm(true)}>🗑 Удалить задачу</button>
          </div>
          {confirm && (
            <Dialog title="Удалить задачу?" size="sm" onClose={() => setConfirm(false)}>
              <div className="mdbody">
                <p className="fsub">Действие необратимо.</p>
              </div>
            </Dialog>
          )}
        </Dialog>
      )
    }
    return <Demo />
  }
}

/** Телефон: окно на весь экран (граница 720px — MOBILE_QUERY). */
export const Phone: Story = { ...sized('md'), parameters: PHONE }
