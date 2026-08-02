// Сториз ленты CI-рана: жизненный цикл рана целиком (очередь → выполняется →
// упал / успех / авто-фикс / ждёт ответа) плюс три состояния загрузки экрана.
// Раньше, чтобы увидеть ран с упавшим шагом, нужно было реально запустить агента
// на машине; сценарии живут в общих фикстурах (`test/fixtures/ci.ts`).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import { RunFeed } from './RunFeed'
import { withBridges } from '../../test/storyBridges'
import {
  NOW,
  autoFixRunCache,
  awaitingInputRunCache,
  failedRunCache,
  makeCommands,
  makeLogSheet,
  makeMetrics,
  makeRun,
  makeRunDetail,
  makeStep,
  planGateRunCache,
  queuedRunCache,
  runningRunCache,
  successRunCache
} from '../../test/fixtures'

const meta: Meta<typeof RunFeed> = {
  title: 'CI/RunFeed',
  component: RunFeed,
  args: {
    runId: 'run-1',
    cache: runningRunCache(),
    onSubscribe: fn(),
    onUnsubscribe: fn(),
    onLoad: fn(),
    onRetry: fn(),
    onRetryFromStep: fn(),
    onDiscardAndRetry: fn(),
    onCancel: fn(),
    onAnswerInteraction: fn(),
    // Время фиксировано: иначе длительности «текущего» шага плыли бы от прогона
    // к прогону, и скриншоты сториз никогда не совпадали бы.
    now: () => NOW,
    // Скачивание лога в сториз никуда не ведёт — иначе браузер начнёт качать файл.
    download: fn()
  },
  decorators: [
    // Кнопка «Консоль» открывает `CiConsole`, а тот читает лог через window.ci.
    withBridges(({ ci }) => ci._commands.push(...makeCommands())),
    (Story) => <div style={{ maxWidth: 860 }}><Story /></div>
  ]
}
export default meta
type Story = StoryObj<typeof RunFeed>

/** В очереди: ран создан, шагов ещё нет — лента объясняет, чего ждать. */
export const Queued: Story = { args: { cache: queuedRunCache() } }

/** Выполняется: первый шаг зелёный, второй идёт с логом, третий ждёт очереди. */
export const Running: Story = {}

/** Выполняется с метриками: у шага видно «типично» и долю текущего времени. */
export const RunningWithMetrics: Story = { args: { metrics: makeMetrics(), onLoadMetrics: fn() } }

/**
 * Упал на шаге: `npm test` с кодом 1, работа модели тоже свалилась — под ней
 * выбор движка и «Повторить работу модели», финальные команды не запускались.
 * Плюс заключение модели сверху: что именно нужно от человека.
 */
export const FailedStep: Story = { args: { cache: failedRunCache() } }

/** Успех: все шаги зелёные, вызов команды моделью вложен под «Работу модели». */
export const Success: Story = { args: { cache: successRunCache() } }

/** Авто-фикс: шаг упал, модель разобралась — лозенг «исправлено моделью», попытка 2. */
export const AutoFixed: Story = { args: { cache: autoFixRunCache() } }

/** Ждёт ответа: уточняющий вопрос модели прямо внутри «Работы модели». */
export const AwaitingClarify: Story = { args: { cache: awaitingInputRunCache() } }

/** Режим плана: гейт «План готов — нужно решение» с «Одобрить» и «На доработку». */
export const PlanGate: Story = { args: { cache: planGateRunCache() } }

/** Грязная рабочая копия (код 66): откат требует набрать слово-подтверждение. */
export const DirtyWorkspace: Story = {
  args: {
    cache: {
      detail: makeRunDetail(makeRun({ status: 'failed' }), [
        makeStep({ id: 'dirty', title: 'подготовить рабочую копию', status: 'failed', exitCode: 66, durationMs: 900 })
      ]),
      log: [],
      conclusion: null
    }
  }
}

/** Простыня лога: 1500 строк одного шага — видно, что хвост обрезан до 500. */
export const HugeLog: Story = {
  args: {
    cache: {
      detail: makeRunDetail(makeRun(), [makeStep()]),
      log: makeLogSheet(1500),
      conclusion: null
    }
  }
}

/** Загрузка: ленты ещё нет — скелетон шагов вместо пустого списка. */
export const Loading: Story = { args: { cache: { detail: null, log: [], conclusion: null, loading: true } } }

/** Ошибка загрузки: сообщение, деталь под «Подробнее» и «Повторить». */
export const LoadError: Story = {
  args: { cache: { detail: null, log: [], conclusion: null, error: 'TypeError: Failed to fetch' } }
}

/** Ошибка поверх уже показанной ленты: данные остаются, ошибка — баннером. */
export const StaleError: Story = {
  args: { cache: { ...runningRunCache(), error: 'HTTP 503: сервер перезагружается' } }
}

/**
 * Раскрытие шага: успешные шаги свёрнуты (сами раскрываются только идущие,
 * упавшие и те, что ждут ответа). Клик по «Работе модели» показывает вложенные
 * вызовы команд, клик по вызову — его лог.
 */
export const ExpandStep: Story = {
  args: { cache: successRunCache() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('Работа модели'))
    await userEvent.click(await canvas.findByText('модель: npm test'))
    await expect(await canvas.findByText(/61 passed/)).toBeInTheDocument()
  }
}

/** Ответ на уточняющий вопрос уходит в ран (а не новым ходом чата). */
export const AnswerClarify: Story = {
  args: { cache: awaitingInputRunCache() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('SQLite'))
    await userEvent.click(canvas.getByRole('button', { name: 'Отправить ответы' }))
    await expect(args.onAnswerInteraction).toHaveBeenCalledWith('run-1', 'it-1', { text: 'SQLite' })
  }
}
