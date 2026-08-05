// Сториз встроенных утилит машины: какой виджет соберётся по `ToolSpec`.
// Терминал получает фейковый PTY (эхо ввода), проводник и однострочная консоль —
// фейковые операции: в сеть не ходит ничего.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { MachineUtility } from './MachineUtility'
import { createFakePty, makeAgent, makeFsEntries, makeMachineOps, makeOfflineAgent, makePolicy } from '../test/fixtures'

const agents = [makeAgent({ id: 'm1', name: 'MacBook' }), makeOfflineAgent({ id: 'm2', name: 'Домашний ПК' })]

const meta: Meta<typeof MachineUtility> = {
  title: 'Machines/MachineUtility',
  component: MachineUtility,
  args: {
    tool: { kind: 'console', agentId: 'm1' },
    agents,
    ops: makeMachineOps(),
    variant: 'embedded',
    onSwitchUtility: fn(),
    onOpenMachines: fn(),
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

/**
 * История и отмена: ↑ достаёт набранное раньше, а пока команда идёт, рядом с ▶
 * живёт «Стоп». Здесь `exec` висит до отмены — как настоящий долгий запрос.
 */
export const ConsoleHistoryAndStop: Story = {
  args: {
    ops: makeMachineOps({
      exec: (_agentId, _command, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Команда отменена')))
        })
    })
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox')
    await userEvent.type(input, 'sleep 100{Enter}')
    await userEvent.click(await canvas.findByTitle('Стоп'))
    await expect(await canvas.findByText('Отменено')).toBeInTheDocument()
    await userEvent.type(input, '{ArrowUp}')
    await expect(input).toHaveValue('sleep 100')
  }
}

/**
 * Общая шапка при ЕДИНСТВЕННОЙ машине: селектора нет, но имя и статус машины
 * (в сети, версия агента) всё равно видны — раньше в этом случае не было ничего.
 */
export const SingleMachineHeader: Story = {
  args: { agents: [makeAgent({ id: 'm1', name: 'MacBook' })], tool: { kind: 'explorer', agentId: 'm1', path: '/home/dev', dir: true } }
}

/**
 * Машина с запретами: бейджи «только чтение», «сеть запрещена» и «каталоги
 * ограничены» (подсказка перечисляет `allowedDirs`), а на месте кнопок изменения
 * файлов — пометка, почему их нет.
 */
export const RestrictedPolicy: Story = {
  args: {
    agents: [
      makeAgent({
        id: 'm1',
        name: 'Сборочный сервер',
        policy: makePolicy({ allowWrite: false, allowNetwork: false, allowedDirs: ['/srv/build', '/tmp'] })
      })
    ],
    tool: { kind: 'explorer', agentId: 'm1', path: '/srv/build', dir: true }
  }
}

/** Из проводника переключаемся в консоль/терминал — та же машина, та же папка. */
export const SwitchExplorerToConsole: Story = {
  args: { tool: { kind: 'explorer', agentId: 'm1', path: '/home/dev/voiceAIChat', dir: true } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    // Имя файла в строке идёт вместе с иконкой, поэтому ждём его по кнопке действия.
    await expect(await canvas.findByLabelText(`Скачать ${makeFsEntries()[2].name}`)).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /Консоль/ }))
    await expect(args.onSwitchUtility).toHaveBeenCalledWith('console', 'm1', '/home/dev/voiceAIChat')
  }
}

/** И обратно: из консоли — в проводник, папка утилиты сохраняется. */
export const SwitchConsoleToExplorer: Story = {
  args: { tool: { kind: 'console', agentId: 'm1', path: '/home/dev/voiceAIChat' } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Проводник/ }))
    await expect(args.onSwitchUtility).toHaveBeenCalledWith('explorer', 'm1', '/home/dev/voiceAIChat')
  }
}
