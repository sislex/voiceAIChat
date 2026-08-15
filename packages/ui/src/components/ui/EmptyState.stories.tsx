// Сториз пустого экрана: текст обязан объяснять следующий шаг, а не
// констатировать пустоту. Ниже — те же формулировки, что стоят в приложении.
import type { Meta, StoryObj } from '@storybook/react'
import { EmptyState } from '@voicechat/ui-kit'

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
  args: {
    icon: '💬',
    title: 'Пока нет бесед — начните первую',
    description: 'Разговор появится в этом списке и сохранит историю вопросов и ответов.'
  }
}
export default meta
type Story = StoryObj<typeof EmptyState>

/** Полный вид: иконка, заголовок, пояснение. */
export const Default: Story = {}

/** С действием — оно и есть «следующий шаг». */
export const WithAction: Story = {
  args: { actionLabel: 'Новый разговор', onAction: () => {} }
}

/** Плотный вариант: колонка канбана, узкая панель, секция страницы. */
export const Compact: Story = {
  args: {
    compact: true,
    icon: '＋',
    title: 'Здесь пока пусто',
    description: 'Перетащите карточку сюда или создайте задачу кнопкой ниже.'
  }
}

/** Без иконки — когда рядом уже есть заголовок секции. */
export const WithoutIcon: Story = {
  args: { icon: false, title: 'Активных рабочих директорий нет', description: 'Появятся, когда ран займёт рабочую копию репозитория на машине.' }
}

/** Как это читается на настоящих экранах. */
export const RealTexts: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <EmptyState icon="🗂" title="Колонок пока нет — создайте первую" description="Колонка на доске — это статус задачи: «Бэклог», «В работе», «Готово»." />
      <EmptyState icon="⌨" title="Команд пока нет — создайте первую" description="Команда — это шаг воркфлоу: сборка, тесты, деплой. Её можно дать проекту и модели." actionLabel="Создать команду" onAction={() => {}} />
      <EmptyState icon="💻" title="Нет машин — добавьте первую" description="Машина подключается в настройках: там выдаётся команда установки агента." />
    </div>
  )
}
