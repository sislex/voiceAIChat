import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatColumn } from './ChatColumn'
import type { Message } from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'

const messages: Message[] = [
  { id: 'u1', conversationId: 'c', role: 'u1', text: 'Вопрос', time: '10:00', createdAt: 1 },
  { id: 'a1', conversationId: 'c', role: 'ai', text: 'Ответ **жирный**', time: '10:01', createdAt: 2 }
]

function renderCol(props: Partial<Parameters<typeof ChatColumn>[0]> = {}): void {
  render(
    <ChatColumn
      title="Тест"
      state="idle"
      messages={messages}
      liveSegments={[]}
      diarization={false}
      voiceBar={null}
      {...props}
    />
  )
}

describe('ChatColumn — кнопка озвучки ответа', () => {
  it('кнопка есть только у AI-сообщений при canSpeak', () => {
    renderCol({ canSpeak: true, onSpeakMessage: vi.fn() })
    // одна кнопка «Озвучить ответ» — только у ai-сообщения
    expect(screen.getAllByLabelText('Озвучить ответ')).toHaveLength(1)
  })

  it('без canSpeak кнопки нет', () => {
    renderCol({ canSpeak: false, onSpeakMessage: vi.fn() })
    expect(screen.queryByLabelText('Озвучить ответ')).not.toBeInTheDocument()
  })

  it('клик зовёт onSpeakMessage с id и текстом ответа', async () => {
    const onSpeak = vi.fn()
    renderCol({ canSpeak: true, onSpeakMessage: onSpeak })
    await userEvent.click(screen.getByLabelText('Озвучить ответ'))
    expect(onSpeak).toHaveBeenCalledWith('a1', 'Ответ **жирный**')
  })

  it('у озвучиваемого сообщения кнопка становится «Остановить озвучку»', () => {
    renderCol({ canSpeak: true, onSpeakMessage: vi.fn(), speakingMessageId: 'a1' })
    expect(screen.getByLabelText('Остановить озвучку')).toBeInTheDocument()
  })
})

describe('ChatColumn — копирование ответа', () => {
  it('кнопка копирования есть у AI-ответа и копирует его текст', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderCol()
    const btn = screen.getByLabelText('Копировать ответ')
    await userEvent.click(btn)
    expect(writeText).toHaveBeenCalledWith('Ответ **жирный**')
  })

  it('у сообщения пользователя кнопки копирования нет', () => {
    renderCol()
    expect(screen.getAllByLabelText('Копировать ответ')).toHaveLength(1) // только ai
  })
})

describe('ChatColumn — экспорт разговора', () => {
  it('меню экспорта: Markdown/JSON зовут onExport с форматом', async () => {
    const onExport = vi.fn()
    renderCol({ onExport })
    await userEvent.click(screen.getByLabelText('Экспорт разговора'))
    const menu = screen.getByTestId('export-menu')
    await userEvent.click(screen.getByText('Markdown (.md)'))
    expect(onExport).toHaveBeenCalledWith('md')

    await userEvent.click(screen.getByLabelText('Экспорт разговора'))
    await userEvent.click(screen.getByText('JSON (.json)'))
    expect(onExport).toHaveBeenCalledWith('json')
    void menu
  })

  it('показывает мету хода под последним ответом ассистента', () => {
    renderCol({ turnMeta: { durationMs: 7200, numTurns: 2, costUsd: 0.0131 } })
    const meta = screen.getByTestId('turn-meta')
    expect(meta.textContent).toContain('7.2с')
    expect(meta.textContent).toContain('2 хода')
    expect(meta.textContent).toContain('$0.0131')
  })

  it('без сообщений кнопки экспорта нет', () => {
    render(
      <ChatColumn
        title="Пусто"
        state="idle"
        messages={[]}
        liveSegments={[]}
        diarization={false}
        onExport={vi.fn()}
        voiceBar={null}
      />
    )
    expect(screen.queryByLabelText('Экспорт разговора')).not.toBeInTheDocument()
  })
})

describe('ChatColumn — переименование разговора по заголовку', () => {
  it('клик по заголовку открывает поле, Enter сохраняет новое имя', async () => {
    const onRename = vi.fn()
    renderCol({ onRenameTitle: onRename })
    await userEvent.click(screen.getByText('Тест'))
    const input = screen.getByLabelText('Новое название разговора')
    await userEvent.clear(input)
    await userEvent.type(input, 'Новое имя{Enter}')
    expect(onRename).toHaveBeenCalledWith('Новое имя')
  })

  it('Escape отменяет редактирование, onRenameTitle не зовётся', async () => {
    const onRename = vi.fn()
    renderCol({ onRenameTitle: onRename })
    await userEvent.click(screen.getByText('Тест'))
    await userEvent.keyboard('{Escape}')
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText('Тест')).toBeInTheDocument()
  })

  it('пустое имя не сохраняется', async () => {
    const onRename = vi.fn()
    renderCol({ onRenameTitle: onRename })
    await userEvent.click(screen.getByText('Тест'))
    const input = screen.getByLabelText('Новое название разговора')
    await userEvent.clear(input)
    await userEvent.keyboard('{Enter}')
    expect(onRename).not.toHaveBeenCalled()
  })

  it('без onRenameTitle клик не открывает редактирование', async () => {
    renderCol()
    await userEvent.click(screen.getByText('Тест'))
    expect(screen.queryByLabelText('Новое название разговора')).not.toBeInTheDocument()
  })
})

describe('ChatColumn — кнопка меню (мобильный сайдбар)', () => {
  it('клик по ☰ зовёт onToggleSidebar', async () => {
    const onToggle = vi.fn()
    renderCol({ onToggleSidebar: onToggle })
    await userEvent.click(screen.getByLabelText('Меню разговоров'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('без onToggleSidebar кнопки нет', () => {
    renderCol()
    expect(screen.queryByLabelText('Меню разговоров')).not.toBeInTheDocument()
  })
})

describe('ChatColumn — простой/подробный вид ответа', () => {
  const withActivity: Message[] = [
    { id: 'u1', conversationId: 'c', role: 'u1', text: 'Вопрос', time: '10:00', createdAt: 1 },
    {
      id: 'a1',
      conversationId: 'c',
      role: 'ai',
      text: 'Ответ',
      time: '10:01',
      createdAt: 2,
      meta: {
        activity: [
          { kind: 'tool_use', summary: 'Bash: ls', detail: 'ls', raw: '{"t":"assistant"}' },
          { kind: 'result', summary: 'Готово', raw: '{"t":"result"}' }
        ]
      }
    }
  ]

  it('простой вид по умолчанию: счётчик есть, секций нет', () => {
    renderCol({ messages: withActivity })
    expect(screen.getByTestId('activity-count').textContent).toContain('2 действия')
    expect(screen.queryByTestId('activity-sections')).toBeNull()
  })

  it('кнопка «Подробнее» раскрывает секции хода', async () => {
    renderCol({ messages: withActivity })
    await userEvent.click(screen.getByTitle('Подробнее'))
    expect(screen.getByTestId('activity-sections')).toBeInTheDocument()
    expect(screen.getAllByTestId('activity-section')).toHaveLength(2)
    // и обратно
    await userEvent.click(screen.getByTitle('Кратко'))
    expect(screen.queryByTestId('activity-sections')).toBeNull()
  })

  it('без активности кнопки переключения нет', () => {
    renderCol()
    expect(screen.queryByTitle('Подробнее')).not.toBeInTheDocument()
  })
})

describe('ChatColumn — встроенная утилита (tool-блок)', () => {
  const toolMsg: Message[] = [
    {
      id: 'a1',
      conversationId: 'c',
      role: 'ai',
      text: '🖥 Консоль\n\n```tool\n{"kind":"console"}\n```',
      time: '10:01',
      createdAt: 2
    }
  ]
  const ops = {
    list: vi.fn(),
    read: vi.fn(),
    write: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    exec: vi.fn()
  }

  it('рендерит консоль внутри ai-сообщения при наличии machineOps', () => {
    renderCol({ messages: toolMsg, machineOps: ops, agents: [] })
    expect(screen.getByTestId('console-embed')).toBeInTheDocument()
  })

  it('встроенный проводник открывает терминал на своей машине и в текущей папке', async () => {
    const open = vi.fn()
    const explorerOps = {
      ...ops,
      list: vi.fn().mockResolvedValue({ root: '/r', cwd: '/r/work', entries: [] })
    }
    const explorerMsg: Message[] = [{
      id: 'a2', conversationId: 'c', role: 'ai',
      text: 'Проводник\n\n```tool\n{"kind":"explorer","agentId":"m1"}\n```',
      time: '10:02', createdAt: 3
    }]
    const agent = { id: 'm1', name: 'MacBook', online: true, policy: { allowWrite: true } } as AgentInfo
    renderCol({ messages: explorerMsg, machineOps: explorerOps, agents: [agent], onOpenTerminal: open })
    await userEvent.click(await screen.findByTitle('Открыть терминал в этой папке'))
    expect(open).toHaveBeenCalledWith('m1', '/r/work')
  })

  it('без machineOps виджет не рендерится (блок просто скрыт)', () => {
    renderCol({ messages: toolMsg })
    expect(screen.queryByTestId('console-embed')).toBeNull()
  })
})

describe('ChatColumn — картинка от модели в сообщении', () => {
  const imgMsg = (text: string): Message[] => [
    { id: 'a1', conversationId: 'c', role: 'ai', text, time: '10:01', createdAt: 2, execTarget: 'm1' }
  ]
  const ops = {
    list: vi.fn(),
    read: vi.fn().mockResolvedValue({ root: '/', cwd: '', dataBase64: 'AAA' }),
    write: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    exec: vi.fn()
  }

  it('рендерит картинку из блока и читает файл с машины сообщения', async () => {
    renderCol({ messages: imgMsg('Готово\n\n```image\n{"path":"/tmp/out.png"}\n```'), machineOps: ops })
    expect(await screen.findByTestId('image-embed')).toBeInTheDocument()
    expect(ops.read).toHaveBeenCalledWith('m1', '/tmp/out.png')
  })

  it('блок вырезан из текста ответа', () => {
    renderCol({ messages: imgMsg('Готово\n\n```image\n{"path":"/tmp/out.png"}\n```'), machineOps: ops })
    expect(screen.getByText('Готово')).toBeInTheDocument()
    expect(screen.queryByText(/tmp\/out\.png/)).toBeNull()
  })

  it('markdown-картинка с локальным путём тоже становится виджетом', async () => {
    renderCol({ messages: imgMsg('Схема: ![Схема](/tmp/a.png)'), machineOps: ops })
    expect(await screen.findByTestId('image-embed')).toBeInTheDocument()
  })

  it('в незавершённом ответе картинка показывается, а блок не мозолит глаза', async () => {
    renderCol({
      state: 'thinking',
      streamingReply: 'Рисую…\n\n```image\n{"path":"/tmp/live.png"}\n```',
      execTarget: 'm1',
      machineOps: ops
    })
    expect(await screen.findByTestId('image-embed')).toBeInTheDocument()
    expect(screen.queryByText(/tmp\/live\.png/)).toBeNull()
  })

  it('без machineOps картинка не рендерится, но и сырой блок не виден', () => {
    renderCol({ messages: imgMsg('Готово\n\n```image\n{"path":"/tmp/out.png"}\n```') })
    expect(screen.queryByTestId('image-embed')).toBeNull()
    expect(screen.queryByText(/tmp\/out\.png/)).toBeNull()
  })
})

describe('ChatColumn — высота поля редактирования', () => {
  // Как в VoiceBar: раскладки в jsdom нет, поэтому метрики задаём стилем,
  // а scrollHeight подменяем «строками» по 20px (паддинги 10+10, рамка 1+1).
  const LINE = 20
  const PAD = 20

  beforeEach(() => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<style id="editarea-metrics">.editarea{line-height:20px;padding:10px 12px;border:1px solid #000}</style>'
    )
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return Math.max(1, this.value.split('\n').length) * LINE + PAD
      }
    })
  })

  afterEach(() => {
    document.getElementById('editarea-metrics')?.remove()
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight
  })

  async function openEdit(text: string): Promise<HTMLTextAreaElement> {
    renderCol({
      onEditMessage: vi.fn(),
      messages: [{ ...messages[0], text }]
    })
    await userEvent.click(screen.getByLabelText('Изменить сообщение'))
    return screen.getByLabelText('Редактирование сообщения') as HTMLTextAreaElement
  }

  it('короткое сообщение — минимум две строки', async () => {
    const area = await openEdit('одна строка')
    expect(area).toHaveAttribute('rows', '2')
    expect(area.style.height).toBe('62px') // 2*20 + 20 + рамка 2
  })

  it('высота считается сразу при открытии правки трёхстрочного сообщения', async () => {
    const area = await openEdit('a\nb\nc')
    expect(area.style.height).toBe('82px')
  })

  it('длинное сообщение упирается в четыре строки', async () => {
    const area = await openEdit('a\nb\nc\nd\ne\nf')
    expect(area.style.height).toBe('102px')
  })

  it('высота растёт при наборе новых строк', async () => {
    const area = await openEdit('a')
    expect(area.style.height).toBe('62px')
    await userEvent.type(area, '{Shift>}{Enter}{/Shift}b{Shift>}{Enter}{/Shift}c')
    expect(area.style.height).toBe('82px')
  })
})

describe('ChatColumn — загрузка сообщений', () => {
  it('loadingMessages=true → показывает лоадер', () => {
    renderCol({ loadingMessages: true, messages: [] })
    expect(screen.getByTestId('messages-loading')).toBeInTheDocument()
    expect(screen.getByText('Загрузка сообщений…')).toBeInTheDocument()
  })

  it('loadingMessages=false → лоадера нет', () => {
    renderCol({ loadingMessages: false })
    expect(screen.queryByTestId('messages-loading')).not.toBeInTheDocument()
  })
})


describe('ChatColumn — снимок машины сообщения', () => {
  it('показывает машину вопроса и ответа без селекторов', () => {
    const machineMessages: Message[] = [
      { id: 'u', conversationId: 'c', role: 'u1', text: 'Вопрос', time: '10:00', createdAt: 1, execTarget: 'm1' },
      { id: 'a', conversationId: 'c', role: 'ai', text: 'Ответ', time: '10:01', createdAt: 2, execTarget: 'none' }
    ]
    const agent = { id: 'm1', name: 'MacBook', online: true } as AgentInfo
    renderCol({ messages: machineMessages, agents: [agent] })

    expect(screen.getByText('Вопрос: MacBook')).toBeInTheDocument()
    expect(screen.getByText('Ответ: Без машины')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})


describe('ChatColumn — машина активного чата в заголовке', () => {
  it('показывает список рядом с названием и передаёт новый выбор', async () => {
    const onChangeExecTarget = vi.fn()
    const agent = { id: 'm1', name: 'MacBook', online: true } as AgentInfo
    renderCol({ agents: [agent], execTarget: null, onChangeExecTarget })

    const select = screen.getByLabelText('Машина активного чата')
    await userEvent.selectOptions(select, 'm1')
    expect(onChangeExecTarget).toHaveBeenCalledWith('m1')
  })
})

describe('ChatColumn — статус стрима внизу пузыря и прерванный ответ', () => {
  it('во время стрима статус и счётчик дублируются под текстом', () => {
    renderCol({
      state: 'thinking',
      streamingReply: 'Длинный ответ…',
      liveActivity: [{ kind: 'tool_use', summary: 'Bash: ls', raw: '{}' }]
    })
    const bottom = screen.getByTestId('live-status-bottom')
    expect(bottom.textContent).toContain('1 действие')
  })

  it('стрим без активности показывает внизу «отвечает…»', () => {
    renderCol({ state: 'thinking', streamingReply: 'Ответ' })
    expect(screen.getByTestId('live-status-bottom').textContent).toContain('Claude отвечает')
  })

  it('сообщение с meta.interrupted показывает пометку о прерванном ответе', () => {
    renderCol({
      messages: [
        {
          id: 'a2',
          conversationId: 'c',
          role: 'ai',
          text: 'Часть ответа',
          time: '10:02',
          createdAt: 3,
          meta: { interrupted: true }
        }
      ]
    })
    expect(screen.getByTestId('msg-interrupted').textContent).toContain('прерван')
  })
})
