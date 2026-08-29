import { describe, it, expect, vi, afterEach } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../../test/a11y'
import { act, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import userEvent from '@testing-library/user-event'
import { RunFeed, type RunFeedCache } from './RunFeed'
import { listCommands, resetCommands } from '../../lib/commands'
import { createFakeCi } from '../../test/fakeApi'
import type { KbRunUsageReport } from '@shared/kb'
import {
  NOW,
  makeInteraction as mkInteraction,
  makeFixAttempt,
  makeLogLine as mkLog,
  makeRun as mkRun,
  makeStep as mkStep
} from '../../test/fixtures'

// Ран, шаги, лог и пауза — общие фикстуры: те же сценарии показывают сториз
// CI/RunFeed, поэтому расхождение с протоколом ловится один раз в одном месте.

function baseProps(cache: RunFeedCache | undefined) {
  return {
    runId: 'run-1', cache,
    onSubscribe: vi.fn(), onUnsubscribe: vi.fn(), onLoad: vi.fn(), onRetry: vi.fn(), onCancel: vi.fn(),
    now: () => NOW
  }
}

describe('RunFeed', () => {
  it('подписывается на ран и подгружает его при монтировании', () => {
    const p = baseProps(undefined)
    render(<RunFeed {...p} />)
    expect(p.onSubscribe).toHaveBeenCalledWith('run-1')
    expect(p.onLoad).toHaveBeenCalledWith('run-1')
  })

  it('рендерит шаги и потоковый лог', () => {
    const cache: RunFeedCache = { detail: { run: mkRun(), steps: [mkStep()], fixAttempts: [], interactions: [] }, log: [mkLog()], conclusion: null }
    render(<RunFeed {...baseProps(cache)} />)
    expect(screen.getByText('npm ci')).toBeInTheDocument()
    // running-шаг раскрыт автоматически → виден лог
    expect(screen.getByText('installing deps…')).toBeInTheDocument()
    expect(screen.getByText('выполняется')).toBeInTheDocument()
  })

  it('показывает фактическую модель стадии отдельно от базовой модели рана', () => {
    const run = mkRun({ llmProvider: 'codex', llmModel: 'gpt-5.6-luna' })
    const executionLlm = {
      source: 'stage' as const, stage: 'model_work' as const, llmEngineId: null,
      provider: 'codex' as const, model: 'gpt-5.6-sol',
      base: { llmEngineId: null, provider: 'codex' as const, model: 'gpt-5.6-luna' }
    }
    render(<RunFeed {...baseProps({ detail: { run, executionLlm, steps: [], fixAttempts: [], interactions: [] }, log: [], conclusion: null })} />)
    expect(screen.getByTestId('ci-execution-llm')).toHaveTextContent('Текущий этап: Разработка')
    expect(screen.getByTestId('ci-execution-llm')).toHaveTextContent('Выполняется на: Codex · gpt-5.6-sol')
    expect(screen.getByTestId('ci-execution-llm')).toHaveTextContent('Базовая модель рана: Codex · gpt-5.6-luna')
  })

  it('показывает literal Claude default только из сохранённого базового снимка', () => {
    const run = mkRun({ llmProvider: 'claude', llmModel: 'default' })
    render(<RunFeed {...baseProps({ detail: { run, executionLlm: {
      source: 'run', stage: null, llmEngineId: null, provider: 'claude', model: 'default',
      base: { llmEngineId: null, provider: 'claude', model: 'default' }
    }, steps: [], fixAttempts: [], interactions: [] }, log: [], conclusion: null })} />)
    expect(screen.getByTestId('ci-execution-llm')).toHaveTextContent('Базовая модель рана: Claude · default')
  })

  it('до старта стадии подписывает базовую модель и нейтрально показывает отсутствие модели', () => {
    const run = mkRun({ llmModel: '' })
    render(<RunFeed {...baseProps({ detail: { run, executionLlm: {
      source: 'run', stage: null, llmEngineId: null, provider: 'claude', model: null,
      base: { llmEngineId: null, provider: 'claude', model: null }
    }, steps: [], fixAttempts: [], interactions: [] }, log: [], conclusion: null })} />)
    expect(screen.getByTestId('ci-execution-llm')).toHaveTextContent('Базовая модель рана: Модель не указана')
  })

  it('двигает длительности рана и шага каждую секунду без новых логов', () => {
    vi.useFakeTimers()
    let current = NOW
    const cache: RunFeedCache = { detail: { run: mkRun(), steps: [mkStep()], fixAttempts: [], interactions: [] }, log: [], conclusion: null }
    const { rerender } = render(<RunFeed {...baseProps(cache)} now={() => current} />)
    expect(screen.getAllByText('4с')).toHaveLength(2)
    act(() => { current += 1_000; vi.advanceTimersByTime(1_000) })
    expect(screen.getAllByText('5с')).toHaveLength(2)
    rerender(<RunFeed {...baseProps({ detail: { run: mkRun({ status: 'success', durationMs: 3_000, finishedAt: 4_000 }), steps: [mkStep({ status: 'success', durationMs: 3_000, finishedAt: 4_000 })], fixAttempts: [], interactions: [] }, log: [], conclusion: null })} now={() => current} />)
    expect(screen.getAllByText('3с')).toHaveLength(2)
    act(() => { current += 1_000; vi.advanceTimersByTime(1_000) })
    expect(screen.getAllByText('3с')).toHaveLength(2)
    vi.useRealTimers()
  })

  it('показывает диагноз, файлы, точечный тест и полный повтор fix-loop', () => {
    const failed = mkStep({ id: 's-test', status: 'failed', title: 'Проверки' })
    const attempt = makeFixAttempt({
      runStepId: failed.id,
      changedFiles: ['src/task.ts'],
      failures: [{ packageName: '@voicechat/ui', file: 'src/task.test.ts', testName: 'открывает карточку', command: 'npm test', message: 'expected true' }],
      targetedTests: [{ command: 'npm test -- src/task.test.ts -t "открывает"', exitCode: 0, timedOut: false, output: 'passed' }],
      fullRerun: { stepId: 's-rerun', exitCode: 1, timedOut: false }
    })
    const cache: RunFeedCache = { detail: { run: mkRun({ status: 'failed' }), steps: [failed], fixAttempts: [attempt], interactions: [] }, log: [], conclusion: null }
    render(<RunFeed {...baseProps(cache)} />)
    expect(screen.getByTestId('ci-fix-attempt')).toHaveTextContent('Изменённые файлы: src/task.ts')
    expect(screen.getByTestId('ci-fix-attempt')).toHaveTextContent('открывает карточку')
    expect(screen.getByTestId('ci-fix-attempt')).toHaveTextContent('Полный повтор: exit 1')
  })

  it('вложенный вызов команды модели под model_work', () => {
    const work = mkStep({ id: 'w1', kind: 'model_work', title: 'работа модели', commandId: null })
    const call = mkStep({ id: 'mc1', kind: 'model_command', parentStepId: 'w1', title: 'model: npm test', commandId: 'cmd-2', position: 2 })
    const cache: RunFeedCache = { detail: { run: mkRun(), steps: [work, call], fixAttempts: [], interactions: [] }, log: [], conclusion: null }
    render(<RunFeed {...baseProps(cache)} />)
    expect(screen.getByText('работа модели')).toBeInTheDocument()
    expect(screen.getByText('model: npm test')).toBeInTheDocument()
  })

  it('dirty workspace требует подтверждение перед откатом', async () => {
    const dirty = mkStep({ id: 'dirty', status: 'failed', exitCode: 66 })
    const cache: RunFeedCache = { detail: { run: mkRun({ status: 'failed' }), steps: [dirty], fixAttempts: [], interactions: [] }, log: [], conclusion: null }
    const onDiscardAndRetry = vi.fn()
    render(<RunFeed {...baseProps(cache)} onDiscardAndRetry={onDiscardAndRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить рабочую копию' }))
    const dialog = await screen.findByTestId('confirm-dialog')
    // Предупреждение дословно то же, что было в нативном диалоге.
    expect(within(dialog).getByText('Все незакоммиченные и неотслеживаемые файлы в рабочем репозитории будут удалены. Продолжить?')).toBeInTheDocument()
    // Необратимо: пока слово не набрано, подтвердить нельзя.
    const ok = within(dialog).getByRole('button', { name: 'Откатить и начать заново' })
    expect(ok).toBeDisabled()
    fireEvent.click(ok)
    expect(onDiscardAndRetry).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'откатить' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Откатить и начать заново' }))
    // Ответ приходит промисом (useConfirm) — ждём следующего такта.
    await waitFor(() => expect(onDiscardAndRetry).toHaveBeenCalledWith('run-1'))
  })

  it('при падении model_work позволяет выбрать Codex и повторить только модель', () => {
    const model = mkStep({ id: 'model-1', kind: 'model_work', slot: null, commandId: null, title: 'Работа модели', status: 'failed' })
    const cache: RunFeedCache = { detail: { run: mkRun({ status: 'failed' }), steps: [model], fixAttempts: [], interactions: [] }, log: [], conclusion: null }
    const onRetryFromStep = vi.fn()
    render(<RunFeed {...baseProps(cache)} onRetryFromStep={onRetryFromStep} />)
    expect(screen.getByText(/Финальные команды не запускались/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Провайдер'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить работу модели' }))
    expect(onRetryFromStep).toHaveBeenCalledWith('run-1', { provider: 'codex', model: '' })
  })

  it('повтор model_work передаёт снимок выбранного исполнителя', () => {
    const model = mkStep({ id: 'model-1', kind: 'model_work', slot: null, commandId: null, title: 'Работа модели', status: 'failed' })
    const cache: RunFeedCache = { detail: { run: mkRun({ status: 'failed' }), steps: [model], fixAttempts: [], interactions: [] }, log: [], conclusion: null }
    const onRetryFromStep = vi.fn()
    render(<RunFeed {...baseProps(cache)} engines={[{ id: 'personal', name: 'Личный', kind: 'claude', isDefault: false }]} onRetryFromStep={onRetryFromStep} />)
    fireEvent.change(screen.getByLabelText('Исполнитель CI-рана'), { target: { value: 'personal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить работу модели' }))
    expect(onRetryFromStep).toHaveBeenCalledWith('run-1', { provider: 'claude', model: 'opus', llmEngineId: 'personal' })
  })

  it('pending-вопрос модели показывает форму и отдаёт ответ наружу', () => {
    const model = mkStep({ id: 'model-1', kind: 'model_work', slot: null, commandId: null, title: 'Работа модели', status: 'running' })
    const cache: RunFeedCache = {
      detail: { run: mkRun({ status: 'awaiting_input' }), steps: [model], fixAttempts: [], interactions: [mkInteraction()] },
      log: [], conclusion: null
    }
    const onAnswerInteraction = vi.fn()
    render(<RunFeed {...baseProps(cache)} onAnswerInteraction={onAnswerInteraction} />)
    expect(screen.getByTestId('ci-clarify')).toBeInTheDocument()
    expect(screen.getByText('ждёт ответа')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('SQLite'))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ответы' }))
    expect(onAnswerInteraction).toHaveBeenCalledWith('run-1', 'it-1', { text: 'SQLite' })
  })

  it('отвеченный вопрос показывается статикой — форма не возвращается', () => {
    const model = mkStep({ id: 'model-1', kind: 'model_work', slot: null, commandId: null, title: 'Работа модели', status: 'success' })
    const answered = mkInteraction({ status: 'answered', answerText: 'SQLite' })
    const cache: RunFeedCache = {
      detail: { run: mkRun({ status: 'success' }), steps: [model], fixAttempts: [], interactions: [answered] },
      log: [], conclusion: null
    }
    render(<RunFeed {...baseProps(cache)} onAnswerInteraction={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Работа модели/ }))
    expect(screen.getByText('Ответ: SQLite')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Отправить ответы' })).not.toBeInTheDocument()
  })

  it('гейт плана даёт одобрить и отправить на доработку', () => {
    const model = mkStep({ id: 'model-1', kind: 'model_work', slot: null, commandId: null, title: 'Работа модели', status: 'running' })
    const gate = mkInteraction({ id: 'it-2', kind: 'plan_approval', questions: [], planText: 'План: 1) сделать' })
    const cache: RunFeedCache = {
      detail: { run: mkRun({ status: 'awaiting_input', mode: 'plan' }), steps: [model], fixAttempts: [], interactions: [gate] },
      log: [], conclusion: null
    }
    const onAnswerInteraction = vi.fn()
    render(<RunFeed {...baseProps(cache)} onAnswerInteraction={onAnswerInteraction} />)
    expect(screen.getByTestId('ci-plan-gate')).toBeInTheDocument()
    expect(screen.getByText('План: 1) сделать')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Комментарий к плану'), { target: { value: 'учти миграции' } })
    fireEvent.click(screen.getByRole('button', { name: 'На доработку' }))
    expect(onAnswerInteraction).toHaveBeenCalledWith('run-1', 'it-2', { decision: 'rework', text: 'учти миграции' })

    fireEvent.click(screen.getByRole('button', { name: 'Одобрить и разрабатывать' }))
    expect(onAnswerInteraction).toHaveBeenLastCalledWith('run-1', 'it-2', { decision: 'approved', text: 'учти миграции' })
  })

  it('кнопка «Повторить весь воркфлоу» вызывает onRetry', () => {
    const cache: RunFeedCache = { detail: { run: mkRun({ status: 'failed' }), steps: [mkStep({ status: 'failed', exitCode: 1 })], fixAttempts: [], interactions: [] }, log: [], conclusion: null }
    const p = baseProps(cache)
    render(<RunFeed {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить весь воркфлоу' }))
    expect(p.onRetry).toHaveBeenCalledWith('run-1')
  })

  it('ручная прокрутка вверх останавливает автоскролл и показывает переход к новым событиям', () => {
    const cache: RunFeedCache = { detail: { run: mkRun(), steps: [mkStep()], fixAttempts: [], interactions: [] }, log: [mkLog()], conclusion: null }
    render(<RunFeed {...baseProps(cache)} />)
    const feed = screen.getByTestId('ci-runfeed')
    Object.defineProperties(feed, {
      scrollHeight: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 100, writable: true }
    })
    fireEvent.scroll(feed)
    const jump = screen.getByRole('button', { name: 'К новым событиям' })
    fireEvent.click(jump)
    expect(screen.queryByRole('button', { name: 'К новым событиям' })).not.toBeInTheDocument()
  })
})

describe('RunFeed — список шагов', () => {
  const pipeline = [
    mkStep({ id: 's1', position: 1, title: 'Клонирование репозитория', status: 'success' }),
    mkStep({ id: 's2', position: 2, title: 'Модель работает', status: 'running' }),
    mkStep({ id: 's3', position: 3, title: 'Ожидание', status: 'queued' }),
    mkStep({ id: 's4', position: 4, title: 'Не требуется', status: 'skipped' }),
    mkStep({ id: 's5', position: 5, title: 'Проверка упала', status: 'failed' }),
    mkStep({ id: 's6', position: 6, title: 'Остановлено', status: 'cancelled' })
  ]
  const cache: RunFeedCache = {
    detail: { run: mkRun({ slotProgress: { done: 2, total: 6, phase: 'работа модели' } }), steps: pipeline, fixAttempts: [], interactions: [] },
    log: [],
    conclusion: null
  }

  it('открывается мышью, показывает фактический порядок и закрывается с задержкой', async () => {
    render(<RunFeed {...baseProps(cache)} />)
    const button = screen.getByRole('button', { name: 'Показать шаги рана' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.mouseEnter(button)
    const panel = screen.getByTestId('ci-run-steps-popover')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '1.Клонирование репозитория✓успех',
      '2.Модель работает▸выполняется',
      '3.Ожидание○в очереди',
      '4.Не требуется–пропущен',
      '5.Проверка упала✕ошибка',
      '6.Остановлено⊘отменён'
    ])
    expect(within(panel).getByText('Модель работает').closest('li')).toHaveAttribute('aria-current', 'step')
    fireEvent.mouseLeave(button)
    fireEvent.mouseEnter(panel)
    await new Promise((resolve) => window.setTimeout(resolve, 170))
    expect(panel).toBeInTheDocument()
    fireEvent.mouseLeave(panel)
    await waitFor(() => expect(screen.queryByTestId('ci-run-steps-popover')).not.toBeInTheDocument())
  })

  it('открывается фокусом и управляется Enter, Space и Esc', async () => {
    const user = userEvent.setup()
    render(<RunFeed {...baseProps(cache)} />)
    const button = screen.getByRole('button', { name: 'Показать шаги рана' })
    await user.tab()
    expect(button).toHaveFocus()
    expect(screen.getByTestId('ci-run-steps-popover')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('ci-run-steps-popover')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('ci-run-steps-popover')).toBeInTheDocument()
    await user.keyboard(' ')
    expect(screen.queryByTestId('ci-run-steps-popover')).not.toBeInTheDocument()
  })

  it('на touch открывается и закрывается нажатием, кликом снаружи', () => {
    render(<><RunFeed {...baseProps(cache)} /><button>Снаружи</button></>)
    const button = screen.getByRole('button', { name: 'Показать шаги рана' })
    fireEvent.pointerDown(button, { pointerType: 'touch' })
    fireEvent.click(button)
    expect(screen.getByTestId('ci-run-steps-popover')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Снаружи' }), { pointerType: 'touch' })
    expect(screen.queryByTestId('ci-run-steps-popover')).not.toBeInTheDocument()
    fireEvent.pointerDown(button, { pointerType: 'touch' })
    fireEvent.click(button)
    fireEvent.pointerDown(button, { pointerType: 'touch' })
    fireEvent.click(button)
    expect(screen.queryByTestId('ci-run-steps-popover')).not.toBeInTheDocument()
  })

  it('ограничивает длинный список viewport и переносит длинные названия', async () => {
    const longSteps = Array.from({ length: 30 }, (_, index) => mkStep({
      id: 'long-' + index,
      position: index + 1,
      title: 'Очень длинное название шага без горизонтальной прокрутки ' + index,
      status: index === 0 ? 'running' : 'queued'
    }))
    const longCache: RunFeedCache = {
      detail: { run: mkRun({ slotProgress: { done: 1, total: 30, phase: 'pipeline' } }), steps: longSteps, fixAttempts: [], interactions: [] },
      log: [],
      conclusion: null
    }
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('ci-run-steps-popover')) return rect(0, 0, 304, 420)
      if (this.getAttribute('aria-label') === 'Показать шаги рана') return rect(292, 450, 24, 24)
      return rect(0, 0, 0, 0)
    })
    vi.stubGlobal('innerWidth', 320)
    vi.stubGlobal('innerHeight', 480)

    render(<RunFeed {...baseProps(longCache)} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Показать шаги рана' }))
    const panel = screen.getByTestId('ci-run-steps-popover')
    expect(within(panel).getAllByRole('listitem')).toHaveLength(30)
    await waitFor(() => expect(panel).toHaveStyle({ top: '22px', left: '8px' }))
    expect(getComputedStyle(panel).overflowY).toBe('auto')
    expect(getComputedStyle(panel).overflowX).toBe('hidden')
    expect(getComputedStyle(within(panel).getByText('Очень длинное название шага без горизонтальной прокрутки 0')).overflowWrap).toBe('anywhere')

    bounds.mockRestore()
    vi.unstubAllGlobals()
  })
})

describe('RunFeed — состояния загрузки, пустоты и ошибки', () => {
  it('пока ленты нет — скелетон шагов, а не пустой список', () => {
    render(<RunFeed {...baseProps(undefined)} />)
    const skeleton = screen.getByTestId('ci-runfeed-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(within(skeleton).getAllByTestId('skeleton')).toHaveLength(4)
  })

  it('ран без шагов объясняет, что лента обновится сама', () => {
    const cache: RunFeedCache = { detail: { run: mkRun({ status: 'queued' }), steps: [], fixAttempts: [], interactions: [] }, log: [], conclusion: null }
    render(<RunFeed {...baseProps(cache)} />)
    expect(screen.getByTestId('empty-state')).toHaveTextContent('Шагов пока нет')
  })

  it('ошибка загрузки видна и повторяется кнопкой', () => {
    const cache: RunFeedCache = { detail: null, log: [], conclusion: null, error: 'ETIMEDOUT' }
    const p = baseProps(cache)
    render(<RunFeed {...p} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Не удалось загрузить ленту рана')
    expect(alert).toHaveTextContent('ETIMEDOUT')
    // onLoad уже был вызван при монтировании — считаем повторный вызов.
    const before = (p.onLoad as ReturnType<typeof vi.fn>).mock.calls.length
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }))
    expect((p.onLoad as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1)
  })

  it('повторная подгрузка уже показанной ленты её не подменяет', () => {
    const cache: RunFeedCache = { detail: { run: mkRun(), steps: [mkStep()], fixAttempts: [], interactions: [] }, log: [], conclusion: null, loading: true }
    render(<RunFeed {...baseProps(cache)} />)
    expect(screen.queryByTestId('ci-runfeed-skeleton')).not.toBeInTheDocument()
    expect(screen.getByText('npm ci')).toBeInTheDocument()
    expect(screen.getByText('Обновляем ленту…')).toBeInTheDocument()
  })
})


describe('RunFeed — своя команда в реестре', () => {
  afterEach(() => resetCommands())

  const finished: RunFeedCache = {
    detail: { run: mkRun({ status: 'success', finishedAt: 4000 }), steps: [mkStep({ status: 'success' })], fixAttempts: [], interactions: [] },
    log: [],
    conclusion: null
  }

  it('регистрирует «Повторить последний ран», пока лента на экране', () => {
    const { unmount } = render(<RunFeed {...baseProps(finished)} />)
    const command = listCommands().find((c) => c.id === 'ci.retry-run')
    expect(command).toBeDefined()
    expect(command!.title).toBe('Повторить последний ран')
    unmount()
    expect(listCommands().find((c) => c.id === 'ci.retry-run')).toBeUndefined()
  })

  it('команда повторяет именно этот ран', () => {
    const p = baseProps(finished)
    render(<RunFeed {...p} />)
    listCommands().find((c) => c.id === 'ci.retry-run')!.run()
    expect(p.onRetry).toHaveBeenCalledWith('run-1')
  })

  it('незавершённый ран повторять нечего — команда выключена', () => {
    const running: RunFeedCache = {
      detail: { run: mkRun({ status: 'running' }), steps: [mkStep()], fixAttempts: [], interactions: [] },
      log: [],
      conclusion: null
    }
    render(<RunFeed {...baseProps(running)} />)
    expect(listCommands().find((c) => c.id === 'ci.retry-run')!.enabled?.()).toBe(false)
  })

  it('лента без загруженного рана команду не даёт', () => {
    render(<RunFeed {...baseProps(undefined)} />)
    expect(listCommands().find((c) => c.id === 'ci.retry-run')).toBeUndefined()
  })

  it('две ленты одного рана дают одну команду, а не две', () => {
    render(
      <>
        <RunFeed {...baseProps(finished)} />
        <RunFeed {...baseProps(finished)} />
      </>
    )
    expect(listCommands().filter((c) => c.id === 'ci.retry-run')).toHaveLength(1)
  })
})

describe('RunFeed — доступность', () => {
  it('без нарушений axe: шаги, лог и ожидание ответа', async () => {
    const cache: RunFeedCache = {
      detail: { run: mkRun(), steps: [mkStep()], fixAttempts: [], interactions: [mkInteraction()] },
      log: [mkLog()],
      conclusion: null
    }
    render(<RunFeed {...baseProps(cache)} onAnswerInteraction={vi.fn()} />)
    await expectNoViolations()
    expectLabelledIconButtons()
  })
})

// Врез «Использование базы знаний» в ленте: цифры текущего рана и ссылки на
// разделы. Данные тянет сам компонент через мост, поэтому без моста вреза нет.
describe('RunFeed — использование базы знаний', () => {
  afterEach(() => { delete (window as { ci?: unknown }).ci })

  const report = (over: Partial<KbRunUsageReport> = {}): KbRunUsageReport => ({
    runId: 'run-1', projectId: 'p1', taskId: 't1', kbContextMode: 'auto', conversationId: 'c1',
    totals: { queries: 3, delivered: 3, empty: 0, errors: 0, toolQueries: 2, sections: 4, documents: 2, chars: 1200, estimatedTokens: 300, promptChars: 6000, lastAt: 5 },
    sections: [{ documentId: 'ci-runner', title: 'CI-раннер', heading: 'Работа модели', anchor: 'model', sourcePath: 'docs/kb/features/ci-runner.md', freshness: 'current', times: 2, autoTimes: 1, chars: 900, estimatedTokens: 225, lastAt: 5 }],
    recent: [],
    ...over
  })

  function mount(over: Partial<KbRunUsageReport> = {}): void {
    window.ci = { ...createFakeCi(), getRunKbUsage: async () => report(over) } as typeof window.ci
    const cache: RunFeedCache = { detail: { run: mkRun(), steps: [mkStep()], fixAttempts: [], interactions: [] }, log: [], conclusion: null }
    render(<RunFeed {...baseProps(cache)} />)
  }

  it('по умолчанию показывает компактную строку и раскрывает отчёт на месте', async () => {
    mount()
    const block = await screen.findByTestId('ci-run-kb-usage')
    const toggle = within(block).getByRole('button', { name: /Использование базы знаний/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('3 обращений')
    expect(toggle).toHaveTextContent('2 разделов')
    expect(toggle).toHaveTextContent('≈300 токенов')
    expect(within(block).queryByRole('link')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(block).getByText('Использованные статьи и разделы')).toBeInTheDocument()
    expect(within(block).getByRole('link', { name: /CI-раннер \/ Работа модели/ })).toHaveAttribute('href', '#/kb/ci-runner')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('режим «выключена» объясняет пустоту настройкой, а не поведением модели', async () => {
    mount({ kbContextMode: 'off', totals: { queries: 0, delivered: 0, empty: 0, errors: 0, toolQueries: 0, sections: 0, documents: 0, chars: 0, estimatedTokens: 0, promptChars: 0, lastAt: null }, sections: [] })
    const block = await screen.findByTestId('ci-run-kb-usage')
    const toggle = within(block).getByRole('button', { name: /Использование базы знаний/ })
    expect(toggle).toHaveTextContent('Отключена')
    await userEvent.click(toggle)
    expect(within(block).getByText(/отключена для этого рана/)).toBeInTheDocument()
  })

  it('без моста CI вреза нет — лента рана от этого не ломается', () => {
    const cache: RunFeedCache = { detail: { run: mkRun(), steps: [mkStep()], fixAttempts: [], interactions: [] }, log: [], conclusion: null }
    render(<RunFeed {...baseProps(cache)} />)
    expect(screen.queryByTestId('ci-run-kb-usage')).not.toBeInTheDocument()
    expect(screen.getByTestId('ci-runfeed')).toBeInTheDocument()
  })
})
