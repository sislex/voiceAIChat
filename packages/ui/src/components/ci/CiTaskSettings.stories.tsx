// Сториз CI-настроек задачи: наследование от проекта, переопределение, движок и
// глубина уточнений. Экран сам грузит данные через `window.ci`, поэтому у каждой
// сториз свой засеянный фейковый мост — сети нет.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from '@storybook/test'
import { CiTaskSettings } from './CiTaskSettings'
import { withBridges, type BridgeSetup } from '../../test/storyBridges'
import { makeCommands, makeLlmConfig } from '../../test/fixtures'

/** Общая часть засева: справочник команд у всех сториз одинаковый. */
const seedCommands: BridgeSetup = ({ ci }) => {
  ci._commands.push(...makeCommands())
}

const meta: Meta<typeof CiTaskSettings> = {
  title: 'CI/CiTaskSettings',
  component: CiTaskSettings,
  args: { projectId: 'p1', taskId: 't1', section: 'model' },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof CiTaskSettings>

/** Унаследовано от проекта: слоты пусты, лозенги — «унаследовано». */
export const Inherited: Story = { decorators: [withBridges(seedCommands)] }

/** Переопределено: у задачи свои слоты и свой движок — лозенги это показывают. */
export const Overridden: Story = {
  decorators: [
    withBridges((bridges) => {
      seedCommands(bridges)
      const { ci } = bridges
      ci.getTaskCi = async () => ({
        config: { beforeModel: ['cmd-1', 'cmd-2'], afterModel: ['cmd-3', 'cmd-5'] },
        overridden: true,
        projectDefault: { beforeModel: ['cmd-1'], afterModel: [] },
        enabledStages: ['before_model', 'model_work', 'after_model', 'summary'],
        browserCheck: { mode: 'off', devServerPort: 5173, startPath: '/' }
      })
      ci.getTaskCiLlm = async () => ({
        config: makeLlmConfig({ provider: 'claude', model: 'opus', mode: 'plan' }),
        overridden: true,
        projectDefault: makeLlmConfig()
      })
    })
  ]
}

/** Движок Codex: список моделей другой, стоимость хода Codex не сообщает. */
export const CodexEngine: Story = {
  decorators: [
    withBridges((bridges) => {
      seedCommands(bridges)
      bridges.ci.getTaskCiLlm = async () => ({
        config: makeLlmConfig({ provider: 'codex', model: 'gpt-5-codex' }),
        overridden: true,
        projectDefault: makeLlmConfig()
      })
    })
  ]
}

/**
 * Cleanup без подготовки: в слоте «после» есть команда, освобождающая рабочую
 * копию, а в «до» нет ни одной — экран предупреждает, потому что удалять будет
 * нечего (или не то).
 */
export const CleanupWarning: Story = {
  args: { section: 'commands' },
  decorators: [
    withBridges((bridges) => {
      seedCommands(bridges)
      bridges.ci.getTaskCi = async () => ({
        config: { beforeModel: [], afterModel: ['cmd-5'] },
        overridden: true,
        projectDefault: { beforeModel: [], afterModel: [] },
        enabledStages: ['before_model', 'model_work', 'after_model', 'summary'],
        browserCheck: { mode: 'off', devServerPort: 5173, startPath: '/' }
      })
    })
  ]
}

/** Режим «План»: подсказка обещает остановку на одобрении плана. */
export const PlanMode: Story = {
  decorators: [
    withBridges((bridges) => {
      seedCommands(bridges)
      bridges.ci.getTaskCiLlm = async () => ({
        config: makeLlmConfig({ mode: 'plan' }),
        overridden: false,
        projectDefault: makeLlmConfig({ mode: 'plan' })
      })
    })
  ]
}

/**
 * Детальное уточнение: появляется поле «сколько вопросов» (1–30) и кнопка
 * сохранения — она видна только у несохранённой правки.
 */
export const ClarifyDetailed: Story = {
  decorators: [withBridges(seedCommands)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.selectOptions(canvas.getByLabelText('Степень уточнения'), 'detailed')
    await expect(canvas.getByLabelText('Число вопросов')).toHaveValue(3)
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Сохранить движок и модель' })).toBeInTheDocument())
  }
}
