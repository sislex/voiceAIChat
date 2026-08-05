// Сториз меню «Машины»: таблица с телеметрией и обслуживанием агента. Устаревшая
// версия, разряженный Android и офлайн-машина в проде зависят от того, что
// творится у пользователя, — здесь это строки таблицы из общих фикстур.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { MachineStatus } from './MachineStatus'
import {
  makeAgent,
  makeAgentCreated,
  makeAndroidAgent,
  makeFleet,
  makeOfflineAgent,
  makeOutdatedAgent,
  makePolicy,
  makeTelemetry,
  makeWindowsDegradedAgent
} from '../test/fixtures'

const meta: Meta<typeof MachineStatus> = {
  title: 'Machines/MachineStatus',
  component: MachineStatus,
  parameters: { layout: 'fullscreen' },
  args: {
    variant: 'page',
    agents: makeFleet(),
    defaultAgentId: 'm1',
    onSetPolicy: fn(),
    onSetDefault: fn(),
    onRegenerateToken: fn(async () => 'tkn-regenerated'),
    onGetConnectionString: fn(async (token: string) => `vcagent:${token}`),
    onUpdateAgent: fn(async () => null),
    onDeleteAgent: fn(),
    onCreateAgent: fn(async (name: string) => makeAgentCreated({ name })),
    onClose: fn()
  }
}
export default meta
type Story = StoryObj<typeof MachineStatus>

/** Парк машин: в сети, устаревший агент, Android с батареей, офлайн. */
export const Fleet: Story = {}

/** Только машина в сети со свежим агентом — «спокойная» таблица. */
export const SingleOnline: Story = { args: { agents: [makeAgent({ id: 'm1', name: 'MacBook' })] } }

/** Офлайн: телеметрии нет, чекбоксы разрешений заблокированы. */
export const OfflineOnly: Story = { args: { agents: [makeOfflineAgent()] } }

/**
 * Устаревший агент: рядом с версией — «устарел, есть vX», кнопки «⧉ команда» и
 * «⬆ обновить». Версия фикстуры считается от серверной `AGENT_VERSION`, поэтому
 * сториз не состарится вместе с релизом.
 */
export const OutdatedAgentVersion: Story = { args: { agents: [makeOutdatedAgent()] } }

/** Android на исходе: 12% без зарядки, 91% CPU и 2 ГБ в рабочем разделе. */
export const AndroidLowBattery: Story = { args: { agents: [makeAndroidAgent()] } }

/**
 * Windows без bash.exe: агент деградировал в cmd.exe — в строке видно и shell,
 * и предупреждающий значок «⚠ нет bash» рядом с ОС.
 */
export const WindowsBashMissing: Story = { args: { agents: [makeWindowsDegradedAgent()] } }

/** Забитый диск и загруженный CPU: полоски уходят в «горячий» цвет. */
export const HotMachine: Story = {
  args: {
    agents: [
      makeAgent({
        id: 'm-hot',
        name: 'Сборочный сервер',
        telemetry: makeTelemetry({
          cpu: { count: 4, loadPct: 97 },
          mem: { totalBytes: 8 * 1024 ** 3, usedBytes: 7.8 * 1024 ** 3 },
          disk: { root: { totalBytes: 200 * 1024 ** 3, freeBytes: 900 * 1024 ** 2 } }
        })
      })
    ]
  }
}

/** Машин нет: подсказка объясняет, что даёт машина и как её добавить. */
export const Empty: Story = { args: { agents: [] } }

/** Первая загрузка реестра: косточки в высоту строки таблицы. */
export const Loading: Story = { args: { agents: [], status: 'loading' } }

/** Ошибка загрузки: сообщение, деталь под «Подробнее», «Повторить». */
export const LoadError: Story = {
  args: { agents: [], status: 'error', error: 'WS: соединение закрыто (1006)', onRetry: fn() }
}

/** Ошибка обновления при показанной таблице — баннером над данными. */
export const StaleError: Story = { args: { status: 'error', error: 'HTTP 503: сервер перезагружается', onRetry: fn() } }

/** Модалка из меню (вариант по умолчанию), а не страница колонки. */
export const AsModal: Story = { args: { variant: 'modal' } }

/**
 * Добавление машины: после «＋ Добавить машину» появляется блок с командой
 * установки агента — единственный момент, когда виден токен.
 */
export const AddMachine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Имя новой машины'), 'Рабочий ноут')
    await userEvent.click(canvas.getByLabelText('Добавить машину'))
    await expect(await canvas.findByText(/Рабочий ноут/)).toBeInTheDocument()
  }
}

/** Быстрое разрешение: чекбокс «Запись файлов» сразу уходит на сервер. */
export const TogglePermission: Story = {
  args: { agents: [makeAgent({ id: 'm1', name: 'MacBook' })] },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByLabelText('Запись файлов'))
    await expect(args.onSetPolicy).toHaveBeenCalledTimes(1)
  }
}

/**
 * Второй шаг удаления: строка подтверждения под машиной объясняет цену — токен
 * отзывается, агент на машине останется запущенным, но больше не подключится.
 */
export const DeleteConfirm: Story = {
  args: { agents: [makeAgent({ id: 'm1', name: 'MacBook' })] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Удалить машину «MacBook»'))
    await expect(canvas.getByTestId('machine-delete-confirm-m1')).toBeInTheDocument()
    await expect(args.onDeleteAgent).not.toHaveBeenCalled()
  }
}

/**
 * Раскрытая политика строки: единственное место в UI, где правятся разрешённые
 * каталоги, паттерны команд и навыки машины (`AgentCard`).
 */
export const PolicyEditor: Story = {
  args: { agents: [makeAgent({ id: 'm1', name: 'MacBook', policy: makePolicy() })] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Политика машины «MacBook»'))
    await expect(canvas.getByText('build: npm run build')).toBeInTheDocument()
  }
}
