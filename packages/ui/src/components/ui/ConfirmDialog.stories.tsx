// Сториз подтверждения: обычное, опасное и необратимое (ввод названия объекта).
import type { Meta, StoryObj } from '@storybook/react'
import { ConfirmDialog } from '@voicechat/ui-kit'

const meta: Meta<typeof ConfirmDialog> = {
  title: 'UI/ConfirmDialog',
  component: ConfirmDialog,
  parameters: { layout: 'fullscreen' },
  args: { onConfirm: () => {}, onCancel: () => {} }
}
export default meta
type Story = StoryObj<typeof ConfirmDialog>

/** Обычное: смена режима разговора. Фокус — на «Отмена». */
export const Default: Story = {
  args: {
    title: 'Полный доступ',
    message: 'Перейти из планирования в «Полный доступ»? Агент сможет выполнять команды и изменять любые доступные файлы.',
    confirmLabel: 'Перейти'
  }
}

/** Опасное: удаление задачи — красная кнопка подтверждения. */
export const Danger: Story = {
  args: { title: 'Удалить «Задача A»?', variant: 'danger', confirmLabel: 'Удалить' }
}

/** Необратимое: кнопка включится, только когда набрано название колонки. */
export const RequireText: Story = {
  args: {
    title: 'Удалить колонку «Готово» со всеми задачами?',
    variant: 'danger',
    confirmLabel: 'Удалить колонку',
    requireText: 'Готово'
  }
}

/** Необратимое в CI: откат незакоммиченных файлов подтверждается словом. */
export const DiscardChanges: Story = {
  args: {
    title: 'Откатить изменения и начать заново?',
    message: 'Все незакоммиченные и неотслеживаемые файлы в рабочем репозитории будут удалены. Продолжить?',
    variant: 'danger',
    confirmLabel: 'Откатить и начать заново',
    requireText: 'откатить'
  }
}
