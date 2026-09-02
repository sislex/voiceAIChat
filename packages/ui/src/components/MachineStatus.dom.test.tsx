import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MachineStatus } from './MachineStatus'
import {
  makeAgent as agent,
  makePolicy as policy,
  makeTelemetry as telemetry,
  makeWindowsDegradedAgent
} from '../test/fixtures'
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
    expect(screen.getByText(/^не запущен/)).toBeInTheDocument()
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
      <MachineStatus agents={[agent({ version: '0.11.1' })]} onSetPolicy={vi.fn()} onUpdateAgent={vi.fn()} onClose={vi.fn()} />
    )
    expect(screen.getByText(`устарел, есть v${AGENT_VERSION}`)).toBeInTheDocument()
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

describe('MachineStatus — удаление машины', () => {
  it('клик по иконке удаления сам ничего не удаляет: сначала подтверждение', () => {
    const onDeleteAgent = vi.fn()
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onDeleteAgent={onDeleteAgent} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Удалить машину «Мак»'))
    expect(onDeleteAgent).not.toHaveBeenCalled()
    expect(screen.getByTestId('machine-delete-confirm-a1')).toBeInTheDocument()
  })

  it('подтверждение удаляет машину по её id', () => {
    const onDeleteAgent = vi.fn()
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onDeleteAgent={onDeleteAgent} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Удалить машину «Мак»'))
    fireEvent.click(screen.getByLabelText('Подтвердить удаление машины «Мак»'))
    expect(onDeleteAgent).toHaveBeenCalledWith('a1')
  })

  it('подтверждение объясняет, что агент останется запущенным, но не подключится', () => {
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onDeleteAgent={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Удалить машину «Мак»'))
    const confirm = screen.getByTestId('machine-delete-confirm-a1')
    expect(confirm).toHaveTextContent(/останется запущенным/)
    expect(confirm).toHaveTextContent(/переустановка с новым токеном/)
    expect(confirm).toHaveTextContent(/целью выполнения/)
  })

  it('«Отмена» убирает подтверждение и не удаляет', () => {
    const onDeleteAgent = vi.fn()
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onDeleteAgent={onDeleteAgent} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Удалить машину «Мак»'))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByTestId('machine-delete-confirm-a1')).toBeNull()
    expect(onDeleteAgent).not.toHaveBeenCalled()
  })

  it('без onDeleteAgent удаления в таблице нет (режим только-просмотр)', () => {
    render(<MachineStatus agents={[agent()]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByLabelText('Удалить машину «Мак»')).toBeNull()
  })
})

describe('MachineStatus — редактор политики строки (AgentCard)', () => {
  it('секция «Терминал (PTY)»: чекбокс sudo и лимиты уходят в onSetPolicy', async () => {
    const onSetPolicy = vi.fn()
    render(<MachineStatus agents={[agent()]} onSetPolicy={onSetPolicy} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Политика машины «Мак»'))
    fireEvent.click(screen.getByLabelText('Подтверждать sudo в терминале'))
    expect(onSetPolicy).toHaveBeenLastCalledWith('a1', expect.objectContaining({ ptyConfirmSudo: true }))
    fireEvent.change(screen.getByLabelText('Лимит одновременных терминалов'), { target: { value: '2' } })
    expect(onSetPolicy).toHaveBeenLastCalledWith('a1', expect.objectContaining({ ptyMaxSessions: 2 }))
  })

  it('стрелка раскрывает каталоги, паттерны и навыки машины', () => {
    render(<MachineStatus agents={[agent({ policy: policy() })]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByTestId('machine-policy-a1')).toBeNull()
    fireEvent.click(screen.getByLabelText('Политика машины «Мак»'))
    const editor = screen.getByTestId('machine-policy-a1')
    expect(within(editor).getByText('/home/dev/projects')).toBeInTheDocument()
    expect(within(editor).getByText('rm\\s+-rf')).toBeInTheDocument()
    expect(within(editor).getByText('build: npm run build')).toBeInTheDocument()
  })

  it('повторный клик по стрелке сворачивает редактор', () => {
    render(<MachineStatus agents={[agent({ policy: policy() })]} onSetPolicy={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Политика машины «Мак»'))
    fireEvent.click(screen.getByLabelText('Политика машины «Мак»'))
    expect(screen.queryByTestId('machine-policy-a1')).toBeNull()
  })

  it('удаление каталога из политики сразу уходит через onSetPolicy', () => {
    const onSetPolicy = vi.fn()
    render(<MachineStatus agents={[agent({ policy: policy() })]} onSetPolicy={onSetPolicy} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Политика машины «Мак»'))
    fireEvent.click(screen.getByLabelText('Удалить /home/dev/projects'))
    expect(onSetPolicy).toHaveBeenCalledWith('a1', expect.objectContaining({ allowedDirs: [] }))
  })

  it('показывает состояние хранилища и позволяет подключить рекомендуемый путь', async () => {
    const onRegisterStorage = vi.fn().mockResolvedValue(null)
    const a = agent({ telemetry: telemetry({ os: { platform: 'darwin', release: '1', arch: 'arm64', isAndroid: false, homePath: '/Users/me' } }) })
    render(<MachineStatus agents={[a]} storages={{ a1: [] }} onSetPolicy={vi.fn()} onRegisterStorage={onRegisterStorage} onClose={vi.fn()} />)
    expect(screen.getByText('не настроено')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Настроить'))
    expect(screen.getByText(/терминал и команды продолжат работать/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Рекомендуемый путь'))
    fireEvent.click(screen.getByText('Проверить и подключить'))
    await waitFor(() => expect(onRegisterStorage).toHaveBeenCalledWith('a1', '/Users/me/ChatAI'))
  })

  it('добавленный навык уходит в политику машины', () => {
    const onSetPolicy = vi.fn()
    render(<MachineStatus agents={[agent({ policy: policy({ skills: [] }) })]} onSetPolicy={onSetPolicy} onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Политика машины «Мак»'))
    const editor = screen.getByTestId('machine-policy-a1')
    fireEvent.change(within(editor).getByPlaceholderText('Имя (напр. сборка)'), { target: { value: 'сборка' } })
    fireEvent.change(within(editor).getByPlaceholderText('Команда (npm run build)'), { target: { value: 'npm run build' } })
    fireEvent.click(within(editor).getByLabelText('Добавить навык'))
    expect(onSetPolicy).toHaveBeenCalledWith('a1', expect.objectContaining({ skills: [{ name: 'сборка', command: 'npm run build' }] }))
  })
})
