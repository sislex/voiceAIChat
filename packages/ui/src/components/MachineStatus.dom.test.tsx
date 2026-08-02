import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MachineStatus } from './MachineStatus'
import { makeAgent as agent, makeTelemetry as telemetry, makeWindowsDegradedAgent } from '../test/fixtures'
import { AGENT_VERSION } from '@shared/version'

describe('MachineStatus', () => {
  it('онлайн-машина: статус «агент запущен» и телеметрия', () => {
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('агент запущен')).toBeInTheDocument()
    const row = screen.getByTestId('machine-row-a1')
    expect(within(row).getByText(/Linux/)).toBeInTheDocument()
    expect(within(row).getByText(/40\.0 ГБ своб/)).toBeInTheDocument()
  })

  it('офлайн-машина: «не запущен», телеметрия скрыта, чекбоксы заблокированы', () => {
    render(
      <MachineStatus
        agents={[agent({ online: false, telemetry: undefined })]}
        onSetPolicy={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('не запущен')).toBeInTheDocument()
    expect(screen.getByLabelText('Сеть')).toBeDisabled()
  })

  it('андроид: показывает батарею и заряд', () => {
    const a = agent({
      telemetry: telemetry({
        os: { platform: 'android', release: '14', arch: 'arm64', isAndroid: true },
        battery: { percent: 76, charging: true }
      })
    })
    render(<MachineStatus agents={[a]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/76%/)).toBeInTheDocument()
    expect(screen.getByText(/Android/)).toBeInTheDocument()
  })

  it('чекбокс разрешения переключает политику через onSetPolicy', () => {
    const onSetPolicy = vi.fn()
    render(<MachineStatus agents={[agent()]} onSetPolicy={onSetPolicy} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Запись файлов'))
    expect(onSetPolicy).toHaveBeenCalledWith('a1', expect.objectContaining({ allowWrite: false }))
  })

  it('нет машин → подсказка', () => {
    render(<MachineStatus agents={[]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Нет добавленных машин/)).toBeInTheDocument()
  })

  it('shell из телеметрии показан в строке машины', () => {
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    const row = screen.getByTestId('machine-row-a1')
    expect(within(row).getByText('bash')).toBeInTheDocument()
  })

  it('bash.exe не найден на Windows → предупреждающий значок в строке', () => {
    const a = makeWindowsDegradedAgent()
    render(<MachineStatus agents={[a]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    const row = screen.getByTestId(`machine-row-${a.id}`)
    expect(within(row).getByText(/нет bash/)).toBeInTheDocument()
    expect(within(row).getByText('cmd.exe')).toBeInTheDocument()
  })

  it('bash найден (не деградировано) → значка предупреждения нет', () => {
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    const row = screen.getByTestId('machine-row-a1')
    expect(within(row).queryByText(/нет bash/)).toBeNull()
  })
})

describe('MachineStatus — добавление машины прямо в попапе', () => {
  it('создаёт машину и сразу показывает команды на все ОС', async () => {
    const onCreateAgent = vi.fn().mockResolvedValue({ id: 'n1', name: 'Ноут', token: 'tok1' })
    const onGetConnectionString = vi.fn().mockResolvedValue('vcagent:x')
    render(
      <MachineStatus
        agents={[]}
        onSetPolicy={vi.fn()}
        onCreateAgent={onCreateAgent}
        onGetConnectionString={onGetConnectionString}
        onClose={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('Имя новой машины'), { target: { value: 'Ноут' } })
    fireEvent.click(screen.getByLabelText('Добавить машину'))

    expect(onCreateAgent).toHaveBeenCalledWith('Ноут')
    const cmds = await screen.findByTestId('agent-commands')
    for (const os of ['Windows', 'macOS', 'Linux', 'Android']) {
      expect(within(cmds).getByLabelText(`Скопировать команду установки для ${os}`)).toBeInTheDocument()
    }
  })

  it('без onCreateAgent блока добавления нет (режим только-просмотр)', () => {
    render(<MachineStatus agents={[]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Имя новой машины')).toBeNull()
  })

  it('перевыпуск токена показывает команды с новым токеном', async () => {
    const onRegenerateToken = vi.fn().mockResolvedValue('tok-new')
    const onGetConnectionString = vi.fn().mockResolvedValue('vcagent:x')
    render(
      <MachineStatus
        agents={[agent()]}
        onSetPolicy={vi.fn()}
        onRegenerateToken={onRegenerateToken}
        onGetConnectionString={onGetConnectionString}
        onClose={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('Перевыпустить токен для Мак'))
    expect(onRegenerateToken).toHaveBeenCalledWith('a1')
    expect(await screen.findByTestId('agent-commands')).toBeInTheDocument()
  })
})

describe('MachineStatus — устаревший агент и обновление', () => {
  it('у устаревшего агента есть значок, кнопка обновления и копирование команды', () => {
    render(
      <MachineStatus agents={[agent({ version: '0.1.0' })]} onSetPolicy={vi.fn()} onUpdateAgent={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText(/устарел, есть v/)).toBeInTheDocument()
    expect(screen.getByLabelText('Обновить агента на Мак')).toBeInTheDocument()
    expect(screen.getByLabelText('Скопировать команду обновления для Мак')).toBeInTheDocument()
  })

  it('у свежего агента кнопок обновления нет', () => {
    render(
      <MachineStatus agents={[agent({ version: AGENT_VERSION })]} onSetPolicy={vi.fn()} onUpdateAgent={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.queryByText(/устарел/)).toBeNull()
    expect(screen.queryByLabelText('Обновить агента на Мак')).toBeNull()
  })

  it('у офлайн-машины обновление не предлагается (версии не знаем)', () => {
    render(
      <MachineStatus
        agents={[agent({ online: false, version: undefined })]}
        onSetPolicy={vi.fn()}
        onUpdateAgent={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(screen.queryByLabelText('Обновить агента на Мак')).toBeNull()
  })

  it('клик по «обновить» зовёт мост и показывает, что обновление запущено', async () => {
    const onUpdateAgent = vi.fn().mockResolvedValue(null)
    render(
      <MachineStatus agents={[agent({ version: '0.1.0' })]} onSetPolicy={vi.fn()} onUpdateAgent={onUpdateAgent} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByLabelText('Обновить агента на Мак'))
    expect(onUpdateAgent).toHaveBeenCalledWith('a1')
    expect(await screen.findByRole('status')).toHaveTextContent('Обновление на «Мак» запущено')
  })

  it('ошибка обновления показывается как есть', async () => {
    const onUpdateAgent = vi.fn().mockResolvedValue('Машина не в сети')
    render(
      <MachineStatus agents={[agent({ version: '0.1.0' })]} onSetPolicy={vi.fn()} onUpdateAgent={onUpdateAgent} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByLabelText('Обновить агента на Мак'))
    expect(await screen.findByRole('status')).toHaveTextContent('Машина не в сети')
  })

  it('команда обновления собирается под ОС машины и не содержит токен', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <MachineStatus agents={[agent({ version: '0.1.0' })]} onSetPolicy={vi.fn()} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByLabelText('Скопировать команду обновления для Мак'))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const cmd = writeText.mock.calls[0][0] as string
    expect(cmd).toContain('install-linux.sh') // телеметрия говорит linux
    expect(cmd).not.toContain('vcagent:')
  })

  it('радио «по умолчанию»: отмечает выбранную машину и вызывает onSetDefault', () => {
    const onSetDefault = vi.fn()
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onSetDefault={onSetDefault} defaultAgentId={null} onClose={vi.fn()} />)
    const radio = screen.getByRole('radio', { name: /по умолчанию/ })
    expect(radio).not.toBeChecked()
    fireEvent.click(radio)
    expect(onSetDefault).toHaveBeenCalledWith('a1')
  })

  it('радио «по умолчанию»: повторный клик по выбранной сбрасывает выбор', () => {
    const onSetDefault = vi.fn()
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onSetDefault={onSetDefault} defaultAgentId="a1" onClose={vi.fn()} />)
    const radio = screen.getByRole('radio', { name: /по умолчанию/ })
    expect(radio).toBeChecked()
    fireEvent.click(radio)
    expect(onSetDefault).toHaveBeenCalledWith(null)
  })
})
