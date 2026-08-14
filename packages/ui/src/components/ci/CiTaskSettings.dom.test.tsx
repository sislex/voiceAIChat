import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { CiTaskSettings } from './CiTaskSettings'
import { createFakeCi } from '../../test/fakeApi'

describe('CiTaskSettings', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('принудительный запуск: кнопка видна только у явно выбранной машины и зовёт forceStartRun', async () => {
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
    expect(screen.getByRole('group', { name: 'Мои машины' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Машины проекта' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Сервер сборки.*по умолчанию/ })).toBeInTheDocument()
    // Наследование машины проекта — некуда «принудительно»: кнопки нет.
    expect(screen.queryByRole('button', { name: 'Запустить на этой машине сейчас' })).not.toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'm2' } })
    expect(window.api?.['tasks:update']).toHaveBeenCalledWith({ projectId: 'p1', taskId: 't1', agentId: 'm2' })
    const forceStart = screen.getByRole('button', { name: 'Запустить на этой машине сейчас' })
    expect(forceStart).toHaveAttribute('title', 'Запустить или продвинуть ожидающий ран на выбранной машине')
    fireEvent.click(forceStart)
    await waitFor(() => expect(force).toHaveBeenCalledWith('p1', 't1', 'm2'))
    expect(await screen.findByText(/мимо очереди/)).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'Запустить на этой машине сейчас' })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'Запустить на этой машине сейчас' })).not.toBeInTheDocument()
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
