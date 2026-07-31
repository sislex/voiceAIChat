import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { RunFeed, type RunFeedCache } from './RunFeed'
import { listCommands, resetCommands } from '../../lib/commands'
import {
  NOW,
  makeInteraction as mkInteraction,
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
    fireEvent.click(screen.getByRole('button', { name: 'Откатить изменения и начать заново' }))
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
