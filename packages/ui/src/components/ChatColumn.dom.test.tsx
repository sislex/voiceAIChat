import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatColumn } from './ChatColumn'
import type { Message } from '@shared/types'
import type { AgentInfo } from '@shared/agentProtocol'
import { makeAiMessage, makeChatPair, makeMachineOps, makeUserMessage } from '../test/fixtures'

// Лента — общая фикстура (её же показывают сториз Chat/ChatColumn): вопрос
// пользователя и ответ модели с markdown-разметкой.
const messages: Message[] = makeChatPair()

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


  it('показывает входящие, исходящие и кэшированные токены под сохранённым ответом', () => {
    renderCol({
      messages: [
        messages[0],
        { ...messages[1], meta: { inputTokens: 1200, outputTokens: 34, cacheReadTokens: 900 } }
      ]
    })
    expect(screen.getByTestId('message-tokens-a1')).toHaveTextContent('↓ 1.2k · ↑ 34 · кэш 900')
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
    makeUserMessage({ id: 'u1' }),
    makeAiMessage({
      id: 'a1',
      meta: {
        activity: [
          { kind: 'tool_use', summary: 'Bash: ls', detail: 'ls', raw: '{"t":"assistant"}' },
          { kind: 'result', summary: 'Готово', raw: '{"t":"result"}' }
        ]
      }
    })
  ]

  it('по умолчанию — минимальный вид: без счётчика и секций, только текст', () => {
    renderCol({ messages: withActivity })
    expect(screen.queryByTestId('activity-count')).toBeNull()
    expect(screen.queryByTestId('activity-sections')).toBeNull()
    expect(screen.getByText('Ответ')).toBeInTheDocument()
  })

  it('кнопка по кругу: минимально → кратко → подробно → минимально', async () => {
    renderCol({ messages: withActivity })
    const btn = screen.getByLabelText('Переключить вид действий')
    // Кратко: появляется счётчик действий, секций ещё нет.
    await userEvent.click(btn)
    expect(screen.getByTestId('activity-count').textContent).toContain('2 действия')
    expect(screen.queryByTestId('activity-sections')).toBeNull()
    // Подробно: секции по каждому действию.
    await userEvent.click(btn)
    expect(screen.getByTestId('activity-sections')).toBeInTheDocument()
    expect(screen.getAllByTestId('activity-section')).toHaveLength(2)
    // Снова минимально.
    await userEvent.click(btn)
    expect(screen.queryByTestId('activity-sections')).toBeNull()
    expect(screen.queryByTestId('activity-count')).toBeNull()
  })

  it('без активности кнопки переключения нет', () => {
    renderCol()
    expect(screen.queryByLabelText('Переключить вид действий')).not.toBeInTheDocument()
  })
})

describe('ChatColumn — встроенная утилита (tool-блок)', () => {
  const toolMsg: Message[] = [
    makeAiMessage({ id: 'a1', text: '🖥 Консоль\n\n```tool\n{"kind":"console"}\n```' })
  ]
  const ops = makeMachineOps()

  it('рендерит консоль внутри ai-сообщения при наличии machineOps', () => {
    renderCol({ messages: toolMsg, machineOps: ops, agents: [] })
    expect(screen.getByTestId('console-embed')).toBeInTheDocument()
  })

  it('встроенный проводник открывает терминал на своей машине и в текущей папке', async () => {
    const open = vi.fn()
    const explorerOps = makeMachineOps({
      list: vi.fn().mockResolvedValue({ root: '/r', cwd: '/r/work', entries: [] })
    })
    const explorerMsg: Message[] = [
      makeAiMessage({ id: 'a2', text: 'Проводник\n\n```tool\n{"kind":"explorer","agentId":"m1"}\n```' })
    ]
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
  const imgMsg = (text: string): Message[] => [makeAiMessage({ id: 'a1', text, execTarget: 'm1' })]
  const ops = makeMachineOps({ read: vi.fn().mockResolvedValue({ root: '/', cwd: '', dataBase64: 'AAA' }) })

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
  it('первая загрузка → скелетон реплик вместо ленты', () => {
    renderCol({ loadingMessages: true, messages: [] })
    const skeleton = screen.getByTestId('messages-loading')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(within(skeleton).getAllByTestId('skeleton')).toHaveLength(3)
    expect(screen.queryByTestId('messages-empty')).not.toBeInTheDocument()
  })

  it('повторная загрузка уже показанной истории её не подменяет скелетоном', () => {
    renderCol({ loadingMessages: true })
    expect(screen.queryByTestId('messages-loading')).not.toBeInTheDocument()
    expect(screen.getByText('Обновляем историю…')).toBeInTheDocument()
    expect(screen.getByText('Вопрос')).toBeInTheDocument()
  })

  it('loadingMessages=false → лоадера нет', () => {
    renderCol({ loadingMessages: false })
    expect(screen.queryByTestId('messages-loading')).not.toBeInTheDocument()
  })

  it('пустая история объясняет следующий шаг', () => {
    renderCol({ loadingMessages: false, messages: [] })
    expect(screen.getByTestId('messages-empty')).toHaveTextContent('Пока нет сообщений — задайте первый вопрос')
  })
})


describe('ChatColumn — снимок машины сообщения', () => {
  it('показывает машину вопроса и ответа без селекторов', () => {
    const machineMessages: Message[] = [
      makeUserMessage({ id: 'u', execTarget: 'm1' }),
      makeAiMessage({ id: 'a', execTarget: 'none' })
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
      messages: [makeAiMessage({ id: 'a2', text: 'Часть ответа', meta: { interrupted: true } })]
    })
    expect(screen.getByTestId('msg-interrupted').textContent).toContain('прерван')
  })
})

describe('ChatColumn — время сообщения в поясе зрителя', () => {
  it('рендерит время из createdAt, а не запечённую серверную строку', () => {
    const ts = new Date(2026, 6, 26, 14, 30).getTime() // локальные 14:30
    renderCol({
      messages: [makeAiMessage({ id: 'a3', time: '23:59', createdAt: ts })]
    })
    expect(screen.getByText('14:30')).toBeInTheDocument()
    expect(screen.queryByText('23:59')).toBeNull()
  })
})


describe('ChatColumn — режим работы', () => {
  const planMessages: Message[] = [
    makeUserMessage({ id: 'u-plan', text: 'Составь план' }),
    makeAiMessage({
      id: 'a-plan',
      text: 'План готов',
      meta: { request: { provider: 'claude', model: 'sonnet', prompt: 'Составь план', promptChars: 11, permissionMode: 'plan', resumed: false } }
    })
  ]

  it('показывает фактический режим в шапке и открывает настройки по клику', async () => {
    const onOpen = vi.fn()
    renderCol({ permissionMode: 'acceptEdits', onOpenConversationSettings: onOpen })
    const badge = screen.getByTestId('mode-badge')
    expect(badge).toHaveTextContent('Разработка')
    await userEvent.click(badge)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('показывает режим, сохранённый у конкретного ответа', () => {
    renderCol({ messages: planMessages })
    expect(screen.getByTestId('message-mode-a-plan')).toHaveTextContent('Планирование')
  })

  it('после планового ответа предлагает выполнить план', async () => {
    const onExecutePlan = vi.fn()
    renderCol({ messages: planMessages, onExecutePlan })
    await userEvent.click(screen.getByRole('button', { name: 'Выполнить план' }))
    expect(onExecutePlan).toHaveBeenCalledWith('a-plan')
  })

  it('не предлагает эскалацию пользователю без машины', () => {
    renderCol({ messages: planMessages, onExecutePlan: vi.fn(), canExecutePlan: false })
    expect(screen.queryByRole('button', { name: 'Выполнить план' })).not.toBeInTheDocument()
  })
})

describe('ChatColumn — вопрос CI-рана, продублированный в чат', () => {
  const QBLOCK = '```questions\n[{"q":"Какую БД взять?","options":["SQLite","Postgres"]}]\n```'
  const ciMessages: Message[] = [
    makeUserMessage({ id: 'u1', text: 'старт' }),
    makeAiMessage({
      id: 'a1',
      text: `Уточняющие вопросы по задаче:\n\n${QBLOCK}`,
      meta: { ciInteraction: { runId: 'run-1', interactionId: 'it-1' } }
    }),
    makeUserMessage({ id: 'u2', text: 'что-то ещё' })
  ]

  it('ответ уходит в ран, а не запускает новый ход чата', async () => {
    const onAnswerCiInteraction = vi.fn()
    const onAnswerQuestions = vi.fn()
    render(
      <ChatColumn
        title="Тест" state="idle" messages={ciMessages} liveSegments={[]} diarization={false} voiceBar={null}
        onAnswerQuestions={onAnswerQuestions}
        onAnswerCiInteraction={onAnswerCiInteraction}
      />
    )
    // Сырой JSON блока в тексте не виден.
    expect(screen.queryByText(/```questions/)).not.toBeInTheDocument()
    // Форма доступна, хотя сообщение не последнее в ленте.
    await userEvent.click(screen.getByLabelText('SQLite'))
    await userEvent.click(screen.getByRole('button', { name: 'Отправить ответы' }))
    expect(onAnswerCiInteraction).toHaveBeenCalledWith('run-1', 'it-1', 'SQLite')
    expect(onAnswerQuestions).not.toHaveBeenCalled()
  })

  it('после ответа (в т.ч. из ленты рана) форма гаснет и остаётся статика', () => {
    render(
      <ChatColumn
        title="Тест" state="idle" messages={ciMessages} liveSegments={[]} diarization={false} voiceBar={null}
        onAnswerQuestions={vi.fn()}
        onAnswerCiInteraction={vi.fn()}
        answeredCiInteractions={['it-1']}
      />
    )
    expect(screen.queryByRole('button', { name: 'Отправить ответы' })).not.toBeInTheDocument()
    expect(screen.getByTestId('questions-static')).toHaveTextContent('Какую БД взять?')
  })
})

describe('ChatColumn — переход из поиска по сообщениям', () => {
  it('подсвечивает и прокручивает к сообщению, через 2 секунды гасит подсветку', () => {
    vi.useFakeTimers()
    try {
      const scrollIntoView = vi.fn()
      // jsdom не реализует прокрутку — подставляем свою, чтобы проверить вызов.
      Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true })
      const onHighlightDone = vi.fn()
      renderCol({ highlightMessageId: 'a1', onHighlightDone })

      const found = document.querySelector('[data-mid="a1"]')
      expect(found).toHaveClass('msg--found')
      expect(document.querySelector('[data-mid="u1"]')).not.toHaveClass('msg--found')
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })

      expect(onHighlightDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2000)
      expect(onHighlightDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('без подсветки ничего не прокручивает', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true })
    renderCol()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(document.querySelector('.msg--found')).toBeNull()
  })
})

describe('ChatColumn — доступность', () => {
  it('без нарушений axe: лента с ответом модели', async () => {
    renderCol({ canSpeak: true, onSpeakMessage: vi.fn(), onDeleteMessage: vi.fn(), onEditMessage: vi.fn(), turnMeta: null })
    await expectNoViolations()
    expectLabelledIconButtons()
  })

  it('без нарушений axe: запись, стриминг ответа и баннер ошибки', async () => {
    renderCol({ state: 'listening', liveSegments: [{ speakerId: 1, text: 'слышно' }], error: 'Сбой сети', onDismissError: vi.fn() })
    await expectNoViolations()
    cleanup()
    renderCol({ state: 'thinking', streamingReply: 'Начал отвечать', liveActivity: [] })
    await expectNoViolations()
    expectLabelledIconButtons()
  })
})

describe('ChatColumn — объявления для скринридера', () => {
  it('стриминг ответа: «отвечает…» на старте, «Ответ получен» по завершении', () => {
    const col = (props: Partial<Parameters<typeof ChatColumn>[0]>): JSX.Element => (
      <ChatColumn title="Тест" state="idle" messages={messages} liveSegments={[]} diarization={false} voiceBar={null} {...props} />
    )
    const { rerender } = render(col({ state: 'thinking', streamingReply: 'Начал отве' }))
    const live = screen.getByTestId('reply-announce')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveTextContent('Claude отвечает…')
    rerender(col({ state: 'idle', streamingReply: '' }))
    expect(screen.getByTestId('reply-announce')).toHaveTextContent('Ответ получен')
  })

  it('в покое живая область пуста — читалке нечего объявлять', () => {
    renderCol()
    expect(screen.getByTestId('reply-announce')).toBeEmptyDOMElement()
  })

  it('распознавание речи — role=log: дочитывается по мере появления сегментов', () => {
    renderCol({ state: 'listening', liveSegments: [{ speakerId: 1, text: 'слышно' }] })
    const block = screen.getByTestId('live-block')
    expect(block).toHaveAttribute('role', 'log')
    expect(block).toHaveAttribute('aria-live', 'polite')
  })
})
