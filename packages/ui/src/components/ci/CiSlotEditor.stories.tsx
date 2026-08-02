// Сториз упорядоченного мультиселекта команд слота: пусто, обычный порядок,
// повторы одной команды, удалённая из справочника команда и режим «только чтение».
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from '@storybook/test'
import { CiSlotEditor } from './CiSlotEditor'
import { makeCommands } from '../../test/fixtures'

const commands = makeCommands()

const meta: Meta<typeof CiSlotEditor> = {
  title: 'CI/CiSlotEditor',
  component: CiSlotEditor,
  args: { label: 'До работы модели', commands, value: [], onChange: () => {} },
  decorators: [(Story) => <div style={{ maxWidth: 520 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof CiSlotEditor>

/** Ничего не выбрано: подсказка и селект «+ Добавить команду…». */
export const Empty: Story = {}

/** Порядок = порядок выполнения; стрелки крайних элементов заблокированы. */
export const Ordered: Story = { args: { value: ['cmd-1', 'cmd-2', 'cmd-3'] } }

/** Команда может повторяться: два прогона тестов вокруг сборки — это норма. */
export const Repeated: Story = { args: { value: ['cmd-1', 'cmd-3', 'cmd-2', 'cmd-3'] } }

/** Команду удалили из справочника: слот честно говорит «— удалена —». */
export const DeletedCommand: Story = { args: { value: ['cmd-1', 'cmd-404'] } }

/** Только чтение (унаследованный слот): ни стрелок, ни селекта добавления. */
export const Disabled: Story = { args: { value: ['cmd-1', 'cmd-5'], disabled: true } }

/** Живой слот: перестановка и удаление действительно меняют список. */
function LiveSlot(): JSX.Element {
  const [value, setValue] = useState<string[]>(['cmd-1', 'cmd-2', 'cmd-3'])
  return (
    <div style={{ maxWidth: 520 }}>
      <CiSlotEditor label="До работы модели" commands={commands} value={value} onChange={setValue} />
      <p className="ci-task-hint">Порядок: {value.join(' → ')}</p>
    </div>
  )
}

export const Interactive: Story = {
  render: () => <LiveSlot />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Поднимаем «test» на строку выше: порядок под списком меняется сразу.
    const [, , up] = canvas.getAllByLabelText('Выше')
    await userEvent.click(up)
    await expect(canvas.getByText('Порядок: cmd-1 → cmd-3 → cmd-2')).toBeInTheDocument()
  }
}
