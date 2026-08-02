// Сториз встроенных утилит машины: какой виджет соберётся по `ToolSpec`.
// Терминал получает фейковый PTY (эхо ввода), проводник и однострочная консоль —
// фейковые операции: в сеть не ходит ничего.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { MachineUtility } from './MachineUtility'
import { createFakePty, makeAgent, makeFsEntries, makeMachineOps, makeOfflineAgent } from '../test/fixtures'

const agents = [makeAgent({ id: 'm1', name: 'MacBook' }), makeOfflineAgent({ id: 'm2', name: 'Домашний ПК' })]

const meta: Meta<typeof MachineUtility> = {
  title: 'Machines/MachineUtility',
  component: MachineUtility,
  args: {
    tool: { kind: 'console', agentId: 'm1' },
    agents,
    ops: makeMachineOps(),
    variant: 'embedded',
    onOpenTerminal: fn(),
    onClose: fn()
  },
  decorators: [(Story) => <div className="msg ai"><div className="bub" style={{ maxWidth: 820 }}><Story /></div></div>]
}
export default meta
type Story = StoryObj<typeof MachineUtility>

/**
 * Консоль без моста PTY (так работает desktop): однострочный ввод команды и её
 * вывод по политике машины. `pty` не задан — виджет деградирует осознанно.
 */
export const ConsoleWithoutPty: Story = {}

/** Живой терминал: есть мост PTY — вместо однострочной консоли поднимается xterm. */
export const Terminal: Story = { args: { pty: createFakePty() } }

/** Проводник по машине: содержимое каталога, размеры и время изменения. */
export const Explorer: Story = {
  args: { tool: { kind: 'explorer', agentId: 'm1', path: '/home/dev/voiceAIChat', dir: true } }
}

/** Проводник, открытый на файле: выделяет строку в родительской папке. */
export const ExplorerOnFile: Story = {
  args: { tool: { kind: 'explorer', agentId: 'm1', path: '/home/dev/voiceAIChat/package.json' } }
}

/** Пустой каталог: список пуст, но панель и кнопки на месте. */
export const ExplorerEmptyDir: Story = {
  args: {
    tool: { kind: 'explorer', agentId: 'm1', path: '/home/dev/пусто', dir: true },
    ops: makeMachineOps({ list: async () => ({ root: '/home/dev', cwd: '/home/dev/пусто', entries: [] }) })
  }
}

/** Ошибка операции: машина отказала (политика или обрыв) — виджет это показывает. */
export const ExplorerError: Story = {
  args: {
    tool: { kind: 'explorer', agentId: 'm1', path: '/root', dir: true },
    ops: makeMachineOps({
      list: async () => {
        throw new Error('Каталог /root запрещён политикой машины')
      }
    })
  }
}

/** Открыто из меню (`variant="modal"`): та же утилита, но окном с крестиком. */
export const AsModal: Story = { args: { variant: 'modal', tool: { kind: 'explorer', agentId: 'm1', dir: true, path: '/home/dev' } } }

/** Выполнение команды в консоли: ввод → вывод фейковых операций. */
export const ConsoleCommand: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox')
    await userEvent.type(input, 'git status{Enter}')
    await expect(await canvas.findByText(/фейковые операции сториз/)).toBeInTheDocument()
  }
}

/** Из проводника можно открыть терминал в текущей папке — это отдельная кнопка. */
export const OpenTerminalFromExplorer: Story = {
  args: { tool: { kind: 'explorer', agentId: 'm1', path: '/home/dev/voiceAIChat', dir: true } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    // Имя файла в строке идёт вместе с иконкой, поэтому ждём его по кнопке действия.
    await expect(await canvas.findByLabelText(`Скачать ${makeFsEntries()[2].name}`)).toBeInTheDocument()
    await userEvent.click(canvas.getByTitle('Открыть терминал в этой папке'))
    await expect(args.onOpenTerminal).toHaveBeenCalledTimes(1)
  }
}
