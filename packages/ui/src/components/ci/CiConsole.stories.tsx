// Сториз диагностической консоли рана. Лог и выполнение команд идут через
// `window.ci` — декоратор подставляет фейковый мост, поэтому сети нет.
// Индикатор режима (только чтение / редактирование) виден сразу, без агента.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { CiConsole } from './CiConsole'
import { withBridges } from '../../test/storyBridges'
import { makeAnsiLog, makeLogSheet } from '../../test/fixtures'

const meta: Meta<typeof CiConsole> = {
  title: 'CI/CiConsole',
  component: CiConsole,
  parameters: { layout: 'fullscreen' },
  args: { runId: 'run-1', onClose: fn() }
}
export default meta
type Story = StoryObj<typeof CiConsole>

/** Пустая консоль: лога у рана ещё нет — только приглашение к команде. */
export const Empty: Story = { decorators: [withBridges()] }

/** Простыня лога: 2000 строк — то, что реально приходит от `npm ci`. */
export const HugeLog: Story = {
  decorators: [
    withBridges(({ ci }) => {
      for (const line of makeLogSheet(2000)) ci._emitLog('run-1', line)
    })
  ]
}

/**
 * Лог с ANSI-раскраской (npm, vitest): экранированные последовательности мы не
 * разбираем — консоль показывает их как есть. Сториз это фиксирует: пока
 * ANSI-парсера нет, «цветной» вывод читается хуже обычного.
 */
export const AnsiColors: Story = {
  decorators: [
    withBridges(({ ci }) => {
      for (const line of makeAnsiLog('s-test')) ci._emitLog('run-1', line)
    })
  ]
}

/** Выполненная команда: read-only ветка сервера отвечает по белому списку. */
export const AfterCommand: Story = {
  decorators: [
    withBridges(({ ci }) => {
      for (const line of makeLogSheet(30)) ci._emitLog('run-1', line)
      ci.consoleExec = async (_runId, command) => ({
        output: `$ ${command}\napps  packages  package.json  README.md\n`,
        exitCode: 0,
        rejected: false,
        message: ''
      })
    })
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Команда консоли'), 'ls')
    await userEvent.click(canvas.getByRole('button', { name: 'Выполнить' }))
    await expect(await canvas.findByText(/package\.json/)).toBeInTheDocument()
  }
}

/** Команда отклонена политикой: сервер режет запись по белому списку. */
export const RejectedCommand: Story = {
  decorators: [
    withBridges(({ ci }) => {
      ci.consoleExec = async () => ({
        output: '',
        exitCode: null,
        rejected: true,
        message: 'Команда отклонена: в режиме только чтения запись запрещена'
      })
    })
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Команда консоли'), 'rm -rf node_modules')
    await userEvent.click(canvas.getByRole('button', { name: 'Выполнить' }))
    await expect(await canvas.findByText(/Команда отклонена/)).toBeInTheDocument()
  }
}

/** Режим редактирования: лозенг меняется, а через 5 минут гаснет сам. */
export const EditMode: Story = {
  decorators: [withBridges()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Режим редактирования' }))
    await expect(canvas.getByText('режим редактирования')).toBeInTheDocument()
  }
}
