import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { CiTaskSettings } from './CiTaskSettings'
import { createFakeCi } from '../../test/fakeApi'

describe('CiTaskSettings', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  // Секции карточки настроек были `span`-ами, а в заголовке стояло английское
  // «InProgress» посреди русского интерфейса.
  it('называет секции по-русски и делает их заголовками', async () => {
    render(<CiTaskSettings section="commands" projectId="p1" taskId="t1" />)
    expect(await screen.findByRole('heading', { name: 'Этапы работы над задачей' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Команды воркфлоу' })).toBeInTheDocument()
    expect(screen.queryByText(/InProgress/)).not.toBeInTheDocument()
  })

  it('показывает все этапы отмеченными, сохраняет независимый выбор и восстанавливает его', async () => {
    const { unmount } = render(<CiTaskSettings section="commands" projectId="p1" taskId="t1" />)
    const model = await screen.findByRole('checkbox', { name: 'Работа модели' })
    const preparation = screen.getByRole('checkbox', { name: 'Подготовка' })
    const after = screen.getByRole('checkbox', { name: 'Финальные команды' })
    const summary = screen.getByRole('checkbox', { name: 'Резюме модели' })
    expect(preparation).toBeChecked(); expect(model).toBeChecked(); expect(after).toBeChecked(); expect(summary).toBeChecked()

    fireEvent.click(model)
    expect(model).not.toBeChecked(); expect(preparation).toBeChecked(); expect(after).toBeChecked(); expect(summary).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить этапы' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранить этапы' })).not.toBeInTheDocument())

    const saved = await window.ci!.getTaskCi('p1', 't1')
    expect(saved.enabledStages).toEqual(['before_model', 'after_model', 'summary'])

    unmount()
    render(<CiTaskSettings section="commands" projectId="p1" taskId="t1" />)
    expect(await screen.findByRole('checkbox', { name: 'Работа модели' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Подготовка' })).toBeChecked()
  })

  it('проверка в браузере: режим выключен, порт и страница появляются вместе с режимом и сохраняются', async () => {
    const { unmount } = render(<CiTaskSettings section="commands" projectId="p1" taskId="t1" />)
    const mode = await screen.findByRole('combobox', { name: 'Режим' })
    expect(mode).toHaveValue('off')
    // Без режима порт и страница не нужны: спрашивать их «на всякий случай» незачем.
    expect(screen.queryByRole('spinbutton', { name: 'Порт dev-сервера' })).not.toBeInTheDocument()

    fireEvent.change(mode, { target: { value: 'chromium' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Порт dev-сервера' }), { target: { value: '8799' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Стартовая страница' }), { target: { value: '/board' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить проверку' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Сохранить проверку' })).not.toBeInTheDocument())

    unmount()
    render(<CiTaskSettings section="commands" projectId="p1" taskId="t1" />)
    expect(await screen.findByRole('combobox', { name: 'Режим' })).toHaveValue('chromium')
    expect(screen.getByRole('spinbutton', { name: 'Порт dev-сервера' })).toHaveValue(8799)
    expect(screen.getByRole('textbox', { name: 'Стартовая страница' })).toHaveValue('/board')
  })

  it('показывает ошибку сохранения этапов и оставляет возможность повторить', async () => {
    window.ci!.putTaskCi = vi.fn(async () => { throw new Error('network down') })
    render(<CiTaskSettings section="commands" projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Резюме модели' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить этапы' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('network down')
    expect(screen.getByRole('button', { name: 'Сохранить этапы' })).toBeInTheDocument()
  })

  it('разделяет запуск на машине через очередь и подтверждённый обход лимита', async () => {
    const start = vi.spyOn(window.ci!, 'startRun')
    const force = vi.spyOn(window.ci!, 'forceStartRun')
    window.ci!.getTaskMachines = vi.fn(async () => ({
      machines: [
        { agentId: 'm1', name: 'Ноутбук', online: true, personal: true, project: false, projectDefault: false },
        { agentId: 'm2', name: 'Сервер сборки', online: true, personal: false, project: true, projectDefault: true }
      ],
      selectedAgentId: null,
      unavailableSelection: null
    }))
    window.api = { 'tasks:update': vi.fn(async () => ({})) } as unknown as typeof window.api
    render(<CiTaskSettings section="machine" projectId="p1" taskId="t1" />)
    const select = await screen.findByLabelText('Машина выполнения')
    await waitFor(() => expect(screen.getByRole('option', { name: /Ноутбук — online/ })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Запустить на этой машине/ })).not.toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'm2' } })
    expect(window.api?.['tasks:update']).toHaveBeenCalledWith({ projectId: 'p1', taskId: 't1', agentId: 'm2' })
    expect(screen.getByText(/Обычный запуск встанет в очередь/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Запустить на этой машине через очередь' }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('p1', 't1', { launch: 'queue', agentId: 'm2' }))
    expect(await screen.findByText(/поставлен в очередь/)).toBeInTheDocument()
    expect(force).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Запустить мимо очереди…' }))
    expect(await screen.findByText(/без учёта maxConcurrentRuns/)).toBeInTheDocument()
    expect(force).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Запустить мимо очереди' }))
    await waitFor(() => expect(force).toHaveBeenCalledWith('p1', 't1', 'm2'))
    expect(await screen.findByText(/Ран запущен.*мимо очереди/)).toBeInTheDocument()
  })

  it('не дублирует машину с двумя основаниями и блокирует offline/утраченный выбор', async () => {
    window.ci!.getTaskMachines = vi.fn(async () => ({
      machines: [{ agentId: 'both-machine-id', name: 'Общий Mac', online: false, personal: true, project: true, projectDefault: true }],
      selectedAgentId: 'both-machine-id',
      unavailableSelection: null
    }))
    render(<CiTaskSettings section="machine" projectId="p1" taskId="t1" />)

    expect(await screen.findByRole('option', { name: /Общий Mac.*offline.*моя \+ проектная.*по умолчанию/ })).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: /Общий Mac/ })).toHaveLength(1)
    expect(screen.getByText(/CI не ждёт подключения/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Запустить на этой машине/ })).not.toBeInTheDocument()
  })

  it('сохраняет понятное отображение недоступного выбора без автоподмены', async () => {
    window.ci!.getTaskMachines = vi.fn(async () => ({
      machines: [{ agentId: 'available-id', name: 'Доступная', online: true, personal: true, project: false, projectDefault: false }],
      selectedAgentId: 'lost-machine-id',
      unavailableSelection: { agentId: 'lost-machine-id', name: null }
    }))
    render(<CiTaskSettings section="machine" projectId="p1" taskId="t1" />)

    expect(await screen.findByLabelText('Машина выполнения')).toHaveValue('lost-machine-id')
    expect(screen.getByRole('option', { name: /Недоступная машина.*lost-mac/ })).toBeInTheDocument()
    expect(screen.getByText(/Выбор не изменён автоматически/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Запустить на этой машине/ })).not.toBeInTheDocument()
  })

  it('блокирует селектор до загрузки и показывает актуальную проектную машину', async () => {
    const response = {
      machines: [{ agentId: 'macbook-id', name: 'MacBook', online: true, personal: false, project: true, projectDefault: true }],
      selectedAgentId: null,
      unavailableSelection: null
    }
    let resolveMachines!: (value: typeof response) => void
    window.ci!.getTaskMachines = vi.fn(() => new Promise<typeof response>((resolve) => { resolveMachines = resolve }))
    render(<CiTaskSettings section="machine" projectId="p1" taskId="t1" />)

    expect(screen.getByTestId('task-machines-skeleton')).toBeInTheDocument()
    expect(screen.queryByLabelText('Машина выполнения')).not.toBeInTheDocument()

    resolveMachines(response)
    expect(await screen.findByText(/По умолчанию проекта:/)).toHaveTextContent('MacBook')
    expect(screen.getByLabelText('Машина выполнения')).toHaveValue('')
  })

  it('при смене проекта скрывает прежний projectDefault до нового ответа', async () => {
    const nextResponse = {
      machines: [{ agentId: 'server-id', name: 'Новый сервер', online: true, personal: false, project: true, projectDefault: true }],
      selectedAgentId: null,
      unavailableSelection: null
    }
    let resolveNext!: (value: typeof nextResponse) => void
    window.ci!.getTaskMachines = vi.fn()
      .mockResolvedValueOnce({
        machines: [{ agentId: 'macbook-id', name: 'MacBook', online: true, personal: false, project: true, projectDefault: true }],
        selectedAgentId: null,
        unavailableSelection: null
      })
      .mockImplementationOnce(() => new Promise<typeof nextResponse>((resolve) => { resolveNext = resolve }))

    const view = render(<CiTaskSettings section="machine" projectId="p1" taskId="t1" />)
    expect(await screen.findByText('MacBook')).toBeInTheDocument()

    view.rerender(<CiTaskSettings section="machine" projectId="p2" taskId="t1" />)
    await waitFor(() => expect(screen.getByTestId('task-machines-skeleton')).toBeInTheDocument())
    expect(screen.queryByText(/MacBook/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Машина выполнения')).not.toBeInTheDocument()

    resolveNext(nextResponse)
    expect(await screen.findByText('Новый сервер')).toBeInTheDocument()
  })

  it('показывает ошибку загрузки машин и повторяет запрос по кнопке', async () => {
    window.ci!.getTaskMachines = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        machines: [{ agentId: 'macbook-id', name: 'MacBook', online: true, personal: false, project: true, projectDefault: true }],
        selectedAgentId: null,
        unavailableSelection: null
      })
    render(<CiTaskSettings section="machine" projectId="p1" taskId="t1" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить машины')
    expect(screen.getByRole('alert')).toHaveTextContent('network down')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByText('MacBook')).toBeInTheDocument()
    expect(window.ci!.getTaskMachines).toHaveBeenCalledTimes(2)
  })

  it('показывает унаследованные движок и модель и сохраняет переопределение', async () => {
    render(<CiTaskSettings section="model" projectId="p1" taskId="t1" />)
    await waitFor(() => expect(screen.getByLabelText('Движок модели')).toHaveValue('claude'))
    expect(screen.getAllByText('унаследовано').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Движок модели'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить движок и модель' }))
    await waitFor(() => expect(screen.getByText('переопределено')).toBeInTheDocument())
  })

  it('режим и глубина уточнений сохраняются вместе с моделью', async () => {
    render(<CiTaskSettings section="model" projectId="p1" taskId="t1" />)
    await waitFor(() => expect(screen.getByLabelText('Режим запуска')).toHaveValue('development'))
    // Число вопросов появляется только у «детального уточнения».
    expect(screen.queryByLabelText('Число вопросов')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Режим запуска'), { target: { value: 'plan' } })
    expect(screen.getByText(/дождётся одобрения/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Степень уточнения'), { target: { value: 'detailed' } })
    fireEvent.change(await screen.findByLabelText('Число вопросов'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить движок и модель' }))

    await waitFor(() => expect(screen.getByText('переопределено')).toBeInTheDocument())
    const saved = await window.ci!.getTaskCiLlm('p1', 't1')
    expect(saved.config).toMatchObject({ mode: 'plan', clarifyLevel: 'detailed', clarifyMax: 12 })
  })

  it('число вопросов зажимается в 1..30', async () => {
    render(<CiTaskSettings section="model" projectId="p1" taskId="t1" />)
    await waitFor(() => expect(screen.getByLabelText('Степень уточнения')).toHaveValue('few'))
    fireEvent.change(screen.getByLabelText('Степень уточнения'), { target: { value: 'detailed' } })
    const input = await screen.findByLabelText('Число вопросов')
    fireEvent.change(input, { target: { value: '99' } })
    expect(input).toHaveValue(30)
    fireEvent.change(input, { target: { value: '0' } })
    expect(input).toHaveValue(1)
  })

  it('возвращает настройку проекта: кнопка сброса видна только при переопределении', async () => {
    render(<CiTaskSettings section="model" projectId="p1" taskId="t1" />)
    await waitFor(() => expect(screen.getByLabelText('Движок модели')).toHaveValue('claude'))
    expect(screen.queryByRole('button', { name: 'Вернуть настройку проекта' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Движок модели'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить движок и модель' }))
    const reset = await screen.findByRole('button', { name: 'Вернуть настройку проекта' })

    fireEvent.click(reset)
    await waitFor(() => expect(screen.getByLabelText('Движок модели')).toHaveValue('claude'))
    expect(screen.queryByRole('button', { name: 'Вернуть настройку проекта' })).not.toBeInTheDocument()
    expect(screen.getAllByText('унаследовано').length).toBeGreaterThan(0)
  })
})
