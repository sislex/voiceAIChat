// Сториз тостов: успех, ошибка (не закрывается сама), уведомление с действием,
// переполненная очередь и вариант на телефоне (стек снизу, над композером).
import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { ToastProvider, useToast, type ToastKind, type ToastOptions } from '@voicechat/ui-kit'

const meta: Meta<typeof ToastProvider> = {
  title: 'UI/Toast',
  component: ToastProvider,
  parameters: { layout: 'fullscreen' }
}
export default meta
type Story = StoryObj<typeof ToastProvider>

const PHONE = {
  viewport: {
    viewports: { phone: { name: 'Телефон 390×844', styles: { width: '390px', height: '844px' }, type: 'mobile' } },
    defaultViewport: 'phone'
  }
}

/** Показывает заданные тосты сразу при открытии сториз. */
function Push({ items }: { items: Array<[ToastKind, string, ToastOptions?]> }): JSX.Element {
  const toast = useToast()
  useEffect(() => {
    for (const [kind, text, options] of items) toast[kind](text, options)
    // Один раз на открытие сториз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <p className="fsub">Тосты появляются в углу; ошибка ждёт крестика.</p>
}

function story(items: Array<[ToastKind, string, ToastOptions?]>, extra?: Record<string, unknown>): Story {
  return {
    ...extra,
    render: () => (
      <ToastProvider avoidSelector=".voicebar">
        <Push items={items} />
      </ToastProvider>
    )
  }
}

/** Успех: операция без видимого результата подтверждает себя сама. */
export const Success: Story = story([['success', 'Скопировано']])

/** Ошибка: остаётся на экране, пока её не закроют. */
export const Error: Story = story([['error', 'Сервер недоступен: 502 Bad Gateway']])

/** Ошибка с безопасным повтором запроса. */
export const WithAction: Story = story([
  ['error', 'Не удалось загрузить доску', { action: { label: 'Повторить', onClick: () => {} } }]
])

/** Очередь: видно три, четвёртый ждёт закрытия любого из них. */
export const Queue: Story = story([
  ['info', 'Сообщение 1', { duration: 0 }],
  ['info', 'Сообщение 2', { duration: 0 }],
  ['success', 'Сообщение 3', { duration: 0 }],
  ['error', 'Сообщение 4 (в очереди)']
])

/** Телефон: стек во всю ширину снизу — и выше композера, а не поверх него. */
export const Phone: Story = {
  ...story([['success', 'Настройки сохранены'], ['error', 'Сеть недоступна']]),
  parameters: PHONE,
  decorators: [
    (Story) => (
      <>
        <Story />
        <div className="voicebar" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 96 }}>
          <div className="vinner">композер VoiceBar</div>
        </div>
      </>
    )
  ]
}
