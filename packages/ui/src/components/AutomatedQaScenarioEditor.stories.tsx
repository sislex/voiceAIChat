import type { Meta, StoryObj } from '@storybook/react'
import type { ProjectDetail } from '@shared/projects'
import type { AutomatedQaScenario } from '@shared/qa'
import { AutomatedQaScenarioEditor } from './AutomatedQaScenarioEditor'

const detail = (scenario?: AutomatedQaScenario): ProjectDetail => ({ id: 'p1', automatedQaScenario: scenario } as unknown as ProjectDetail)

const meta = {
  title: 'Projects/Automated QA scenario',
  component: AutomatedQaScenarioEditor,
  args: { detail: detail(), isOwner: true, onUpdate: () => undefined }
} satisfies Meta<typeof AutomatedQaScenarioEditor>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}
export const Filled: Story = {
  args: {
    detail: detail({
      startUrl: 'http://localhost:5173/#/projects/p1',
      steps: [
        { id: 's1', title: 'Открыть доску', action: { kind: 'wait', selector: '.jboard' } },
        { id: 's2', title: 'Создать задачу', action: { kind: 'click', selector: '#create' }, expectText: 'Новая задача' },
        { id: 's3', title: 'Ввести название', action: { kind: 'type', selector: 'input[name=title]', text: 'Проверка' }, expectAbsentText: 'Ошибка' }
      ]
    })
  }
}
export const ReadOnlyMember: Story = { args: { ...Filled.args, isOwner: false } }
