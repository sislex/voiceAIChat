import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

describe('ChatColumn — контекст веб-превью в истории', () => {
  it('показывает старые сообщения без meta и раскрывает полный контекст нового', async () => {
    const previewElement = { tag: 'section', id: 'hero', classes: ['wide'], dataAttributes: { 'data-kind': 'hero' }, selector: '#hero', ancestors: ['html', 'body', 'section#hero'], rect: { x: 0, y: 0, top: 0, right: 800, bottom: 300, left: 0, width: 800, height: 300 }, pageUrl: 'https://example.test/page', viewport: { width: 1280, height: 720 }, outerHTML: '<section id="hero">Title</section>', text: 'Title', styles: { font: '16px sans-serif', color: 'black', backgroundColor: 'white', margin: '0', padding: '8px', border: 'none', width: '800px', height: '300px', position: 'static', display: 'block', flex: '0 1 auto', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'normal', justifyContent: 'normal', gap: 'normal', grid: 'none', gridTemplateColumns: 'none', gridTemplateRows: 'none', gridArea: 'auto' } }
    renderCol({ messages: [{ ...messages[0], meta: { previewElement } }, messages[1]] })
    const context = screen.getByTestId('message-preview-context')
    expect(context).toHaveTextContent('section#hero · https://example.test/page')
    await userEvent.click(context.querySelector('summary')!)
    expect(context).toHaveTextContent('"selector": "#hero"')
  })
})

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

describe('ChatColumn — копирование сообщений', () => {
  it('кнопка ответа сохраняет доступное имя и копирует полный исходный текст', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderCol()

    const button = screen.getByRole('button', { name: 'Копировать ответ' })
    expect(button).toHaveAttribute('title', 'Копировать ответ')
    await userEvent.click(button)
    expect(writeText).toHaveBeenCalledWith('Ответ **жирный**')
  })

  it('кнопка вопроса копирует ровно m.text без preview-контекста', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const text = '  Первая строка\nВторая строка  '
    const previewElement = { tag: 'section', id: 'hero', classes: [], dataAttributes: {}, selector: '#hero', ancestors: ['body'], rect: { x: 0, y: 0, top: 0, right: 1, bottom: 1, left: 0, width: 1, height: 1 }, pageUrl: 'https://example.test', viewport: { width: 320, height: 640 }, outerHTML: '<section>Не копировать</section>', text: 'Не копировать', styles: { font: '', color: '', backgroundColor: '', margin: '', padding: '', border: '', width: '', height: '', position: '', display: '', flex: '', flexDirection: '', flexWrap: '', alignItems: '', justifyContent: '', gap: '', grid: '', gridTemplateColumns: '', gridTemplateRows: '', gridArea: '' } }
    renderCol({ messages: [makeUserMessage({ id: 'u-copy', text, meta: { previewElement } })] })

    const button = screen.getByRole('button', { name: 'Копировать вопрос' })
    expect(button).toHaveAttribute('title', 'Копировать вопрос')
    await userEvent.click(button)
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(text)
  })

  it('подтверждение привязано к выбранному сообщению и сбрасывается через 1500 мс', async () => {
    vi.useFakeTimers()
    try {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      renderCol({ messages: [makeUserMessage({ id: 'u1', text: 'Первый' }), makeUserMessage({ id: 'u2', text: 'Второй' })] })
      const buttons = screen.getAllByRole('button', { name: 'Копировать вопрос' })

      fireEvent.click(buttons[0]!)
      await act(async () => {})
      expect(buttons[0]).toHaveTextContent('✓')
      expect(buttons[1]).toHaveTextContent('⧉')

      act(() => vi.advanceTimersByTime(1500))
      expect(buttons[0]).toHaveTextContent('⧉')
      expect(buttons[1]).toHaveTextContent('⧉')
    } finally {
      vi.useRealTimers()
    }
  })

  it('нативная кнопка вопроса фокусируется и активируется с клавиатуры', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderCol({ messages: [makeUserMessage({ id: 'u-keyboard', text: 'С клавиатуры' })] })

    const button = screen.getByRole('button', { name: 'Копировать вопрос' })
    button.focus()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(writeText).toHaveBeenLastCalledWith('С клавиатуры')
    await userEvent.keyboard(' ')
    expect(writeText).toHaveBeenCalledTimes(2)
  })

  it('не показывает ложное подтверждение при отказе Clipboard API и fallback', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException('Нет прав', 'NotAllowedError')) } })
    const execCommand = vi.fn().mockReturnValue(false)
    Object.assign(document, { execCommand })
    renderCol()

    const button = screen.getByRole('button', { name: 'Копировать вопрос' })
    await userEvent.click(button)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(button).toHaveTextContent('⧉')
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

  it('закрывает меню экспорта по нажатию вне него', async () => {
    renderCol({ onExport: vi.fn() })
    await userEvent.click(screen.getByLabelText('Экспорт разговора'))
    expect(screen.getByTestId('export-menu')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Тест'))
    expect(screen.queryByTestId('export-menu')).not.toBeInTheDocument()
  })

  it('открытие меню другого чата закрывает предыдущее', async () => {
    render(
      <>
        <ChatColumn title="Первый" state="idle" messages={messages} liveSegments={[]} diarization={false} voiceBar={null} onExport={vi.fn()} />
        <ChatColumn title="Второй" state="idle" messages={messages} liveSegments={[]} diarization={false} voiceBar={null} onExport={vi.fn()} />
      </>
    )
    const triggers = screen.getAllByLabelText('Экспорт разговора')
    await userEvent.click(triggers[0]!)
    expect(screen.getAllByTestId('export-menu')).toHaveLength(1)

    await userEvent.click(triggers[1]!)
    expect(screen.getAllByTestId('export-menu')).toHaveLength(1)
    expect(triggers[0]).toHaveAttribute('aria-expanded', 'false')
    expect(triggers[1]).toHaveAttribute('aria-expanded', 'true')
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
    await userEvent.click(screen.getByLabelText('Закрыть боковую панель'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('без onToggleSidebar кнопки нет', () => {
    renderCol()
    expect(screen.queryByLabelText('Закрыть боковую панель')).not.toBeInTheDocument()
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

  it('«Вид ответа» — список: минимально → кратко → подробно, переключается', async () => {
    renderCol({ messages: withActivity })
    const select = screen.getByLabelText('Вид ответа') as HTMLSelectElement
    // Кратко: появляется счётчик действий, секций ещё нет.
    await userEvent.selectOptions(select, 'brief')
    expect(screen.getByTestId('activity-count').textContent).toContain('2 действия')
    expect(screen.queryByTestId('activity-sections')).toBeNull()
    // Подробно: секции по каждому действию.
    await userEvent.selectOptions(select, 'detailed')
    expect(screen.getByTestId('activity-sections')).toBeInTheDocument()
    expect(screen.getAllByTestId('activity-section')).toHaveLength(2)
    // Обратно минимально.
    await userEvent.selectOptions(select, 'minimal')
    expect(screen.queryByTestId('activity-sections')).toBeNull()
    expect(screen.queryByTestId('activity-count')).toBeNull()
  })

  it('без активности списка «Вид ответа» нет', () => {
    renderCol()
    expect(screen.queryByLabelText('Вид ответа')).not.toBeInTheDocument()
  })

  it('шапка ответа: копирование, модель на ховере движка, время старта; стоимость в подвале', () => {
    const msg = makeAiMessage({ id: 'ai-head', engine: 'claude', meta: { model: 'opus', durationMs: 5000, costUsd: 0.1234, activity: [] } })
    renderCol({ messages: [msg] })
    // Копировать — в шапке ответа.
    expect(screen.getByLabelText('Копировать ответ')).toBeInTheDocument()
    // Движок с моделью: title и скрытый спан модели.
    const engine = document.querySelector('.msg-engine') as HTMLElement
    expect(engine.getAttribute('title')).toContain('opus')
    expect(engine.querySelector('.msg-model')?.textContent).toContain('opus')
    // Время начала ответа присутствует.
    expect(document.querySelector('.msg-start')).toBeTruthy()
    // Реальная стоимость из ответа модели.
    expect(screen.getByTestId('message-cost-ai-head').textContent).toBe('$0.12')
  })

  it('расчётная стоимость (модель не назвала цену) помечается «≈»', () => {
    const msg = makeAiMessage({ id: 'ai-est', engine: 'claude', meta: { model: 'opus', inputTokens: 1000, outputTokens: 2000 } })
    renderCol({ messages: [msg] })
    expect(screen.getByTestId('message-cost-ai-est').textContent).toContain('≈ $')
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

  it('встроенный проводник переключается на консоль своей машины в текущей папке', async () => {
    const open = vi.fn()
    const explorerOps = makeMachineOps({
      list: vi.fn().mockResolvedValue({ root: '/r', cwd: '/r/work', entries: [] })
    })
    const explorerMsg: Message[] = [
      makeAiMessage({ id: 'a2', text: 'Проводник\n\n```tool\n{"kind":"explorer","agentId":"m1"}\n```' })
    ]
    const agent = { id: 'm1', name: 'MacBook', online: true, policy: { allowWrite: true } } as AgentInfo
    renderCol({ messages: explorerMsg, machineOps: explorerOps, agents: [agent], onSwitchUtility: open })
    // Ждём прочитанную папку: до неё переключателю нечего сохранять.
    await screen.findByText('Папка пуста')
    await userEvent.click(screen.getByRole('button', { name: /Консоль/ }))
    expect(open).toHaveBeenCalledWith('console', 'm1', '/r/work')
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

  it('пустая история не показывает информационный блок', () => {
    renderCol({ loadingMessages: false, messages: [] })
    expect(screen.queryByTestId('messages-empty')).not.toBeInTheDocument()
    expect(screen.queryByText('Пока нет сообщений — задайте первый вопрос')).not.toBeInTheDocument()
    expect(screen.queryByText(/Наберите текст в поле ниже/)).not.toBeInTheDocument()
  })
})


describe('ChatColumn — снимок машины сообщения', () => {
  it('показывает машину ответа в шапке; у ответа без машины — «Без машины»', () => {
    const machineMessages: Message[] = [
      makeUserMessage({ id: 'u', execTarget: 'm1' }),
      makeAiMessage({ id: 'a', execTarget: 'none' })
    ]
    const agent = { id: 'm1', name: 'MacBook', online: true } as AgentInfo
    renderCol({ messages: machineMessages, agents: [agent] })

    // Машина ответа — в шапке карточки ассистента, сразу за движком/моделью.
    const head = document.querySelector('.msg.ai .msg-machine-head') as HTMLElement
    expect(head.textContent).toBe('Без машины')
    // Списка выбора машины в ленте нет.
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

describe('ChatColumn — активный стрим и прерванный ответ', () => {
  it('шапка живого ответа берёт движок/модель/машину из claude.start, а не из догадок клиента', () => {
    const agent = { id: 'm1', name: 'Prod', online: true } as never
    renderCol({
      state: 'thinking',
      streamingReply: 'Отвечаю…',
      aiLabel: 'Claude',
      execTarget: null,
      agents: [agent],
      liveTarget: { provider: 'codex', model: 'gpt-5.6-sol', execTarget: 'm1' }
    })
    const engine = screen.getByTestId('live-engine')
    expect(engine).toHaveTextContent('Codex')
    expect(engine).toHaveTextContent('gpt-5.6-sol')
    expect(engine).toHaveAttribute('title', 'Модель: gpt-5.6-sol')
    expect(screen.getByTestId('live-machine')).toHaveTextContent('Prod')
  })

  it('без claude.start шапка живого ответа — из aiLabel/execTarget разговора', () => {
    renderCol({ state: 'thinking', streamingReply: 'Отвечаю…', aiLabel: 'Codex', execTarget: null })
    expect(screen.getByTestId('live-engine')).toHaveTextContent('Codex')
    expect(screen.getByTestId('live-engine')).not.toHaveAttribute('title')
    expect(screen.getByTestId('live-machine')).toHaveTextContent('Сервер')
  })

  it('не дублирует lifecycle-статус в ленте', () => {
    renderCol({
      state: 'thinking',
      streamingReply: 'Длинный ответ…',
      liveActivity: [{ kind: 'tool_use', summary: 'Bash: ls', raw: '{}' }]
    })
    expect(screen.queryByTestId('think')).not.toBeInTheDocument()
    expect(screen.queryByTestId('live-status-bottom')).not.toBeInTheDocument()
  })

  it('сообщение с meta.interrupted показывает пометку о прерванном ответе', () => {
    renderCol({
      messages: [makeAiMessage({ id: 'a2', text: 'Часть ответа', meta: { interrupted: true } })]
    })
    expect(screen.getByTestId('msg-interrupted').textContent).toContain('прерван')
  })
})

describe('ChatColumn — время сообщения в поясе зрителя', () => {
  it('рендерит время из createdAt в формате ЧЧ:ММ:СС, а не запечённую серверную строку', () => {
    const ts = new Date(2026, 6, 26, 14, 30, 12).getTime() // локальные 14:30:12
    renderCol({
      messages: [makeAiMessage({ id: 'a3', time: '23:59', createdAt: ts })]
    })
    expect(screen.getByText('14:30:12')).toBeInTheDocument()
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


describe('ChatColumn — автопрокрутка ленты', () => {
  function metrics(el: HTMLElement, values: { scrollHeight: number; clientHeight: number; scrollTop: number }): void {
    Object.defineProperties(el, {
      scrollHeight: { configurable: true, get: () => values.scrollHeight },
      clientHeight: { configurable: true, get: () => values.clientHeight },
      scrollTop: {
        configurable: true,
        get: () => values.scrollTop,
        set: (next: number) => { values.scrollTop = next }
      }
    })
  }

  const col = (props: Partial<Parameters<typeof ChatColumn>[0]>): JSX.Element => (
    <ChatColumn
      title="Тест"
      state="thinking"
      messages={messages}
      liveSegments={[]}
      diarization={false}
      voiceBar={<div data-testid="composer">composer</div>}
      {...props}
    />
  )

  it('следует за токенами у конца с допуском по фактической дистанции', () => {
    const { rerender } = render(col({ conversationId: 'scroll-near', streamingReply: 'О' }))
    const scroll = screen.getByTestId('scroll')
    const box = { scrollHeight: 1000, clientHeight: 300, scrollTop: 610 }
    metrics(scroll, box)
    fireEvent.wheel(scroll)
    fireEvent.scroll(scroll) // до конца 90px — внутри порога 100px

    box.scrollHeight = 1080
    rerender(col({ conversationId: 'scroll-near', streamingReply: 'Ответ' }))

    expect(box.scrollTop).toBe(1080)
    expect(screen.queryByRole('button', { name: 'К новому сообщению' })).not.toBeInTheDocument()
  })

  it('ручная прокрутка вверх сохраняет scrollTop при новых токенах и показывает кнопку', () => {
    const { rerender } = render(col({ conversationId: 'scroll-reading', streamingReply: 'О' }))
    const scroll = screen.getByTestId('scroll')
    const box = { scrollHeight: 1000, clientHeight: 300, scrollTop: 480 }
    metrics(scroll, box)
    fireEvent.wheel(scroll)
    fireEvent.scroll(scroll)

    box.scrollHeight = 1160
    rerender(col({ conversationId: 'scroll-reading', streamingReply: 'Ответ растёт' }))

    expect(box.scrollTop).toBe(480)
    expect(screen.getByRole('button', { name: 'К новому сообщению' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'К новому сообщению' }).closest('.new-message-row')?.nextElementSibling).toHaveClass('chat-composer')
  })

  it('кнопка возвращает вниз, включает follow и исчезает', async () => {
    const { rerender } = render(col({ conversationId: 'scroll-return', streamingReply: 'О' }))
    const scroll = screen.getByTestId('scroll')
    const box = { scrollHeight: 1000, clientHeight: 300, scrollTop: 300 }
    metrics(scroll, box)
    fireEvent.wheel(scroll)
    fireEvent.scroll(scroll)
    rerender(col({ conversationId: 'scroll-return', streamingReply: 'Ответ' }))

    const button = screen.getByRole('button', { name: 'К новому сообщению' })
    expect(button).not.toHaveFocus()
    await userEvent.click(button)
    expect(box.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: 'К новому сообщению' })).not.toBeInTheDocument()

    box.scrollHeight = 1200
    rerender(col({ conversationId: 'scroll-return', streamingReply: 'Ответ ещё длиннее' }))
    expect(box.scrollTop).toBe(1200)
  })

  it('самостоятельный возврат к нижней границе снова включает follow', () => {
    const { rerender } = render(col({ conversationId: 'scroll-self-return', streamingReply: 'О' }))
    const scroll = screen.getByTestId('scroll')
    const box = { scrollHeight: 1000, clientHeight: 300, scrollTop: 400 }
    metrics(scroll, box)
    fireEvent.wheel(scroll)
    fireEvent.scroll(scroll)
    rerender(col({ conversationId: 'scroll-self-return', streamingReply: 'Ответ' }))
    expect(screen.getByRole('button', { name: 'К новому сообщению' })).toBeInTheDocument()

    box.scrollTop = 700
    fireEvent.scroll(scroll)
    expect(screen.queryByRole('button', { name: 'К новому сообщению' })).not.toBeInTheDocument()
    box.scrollHeight = 1100
    rerender(col({ conversationId: 'scroll-self-return', streamingReply: 'Ответ растёт' }))
    expect(box.scrollTop).toBe(1100)
  })

  it('хранит ручную позицию отдельно для разговоров и восстанавливает её после переключения', () => {
    const { rerender } = render(col({ conversationId: 'scroll-chat-a', streamingReply: 'A' }))
    const scroll = screen.getByTestId('scroll')
    const box = { scrollHeight: 1000, clientHeight: 300, scrollTop: 350 }
    metrics(scroll, box)
    fireEvent.wheel(scroll)
    fireEvent.scroll(scroll)

    rerender(col({ conversationId: 'scroll-chat-b', streamingReply: 'B' }))
    expect(box.scrollTop).toBe(1000)
    box.scrollTop = 520
    fireEvent.scroll(scroll)

    rerender(col({ conversationId: 'scroll-chat-a', streamingReply: 'A2' }))
    expect(box.scrollTop).toBe(350)
  })

  it('новое собственное сообщение возвращает вниз и начинает новый follow-ход', () => {
    const { rerender } = render(col({ conversationId: 'scroll-own', streamingReply: '' }))
    const scroll = screen.getByTestId('scroll')
    const box = { scrollHeight: 1000, clientHeight: 300, scrollTop: 300 }
    metrics(scroll, box)
    fireEvent.wheel(scroll)
    fireEvent.scroll(scroll)

    const own = makeUserMessage({ id: 'new-own', text: 'Новый вопрос' })
    box.scrollHeight = 1120
    rerender(col({ conversationId: 'scroll-own', messages: [...messages, own], streamingReply: '' }))
    expect(box.scrollTop).toBe(1120)
  })
})

describe('ChatColumn — подготовка ответа', () => {
  it('показывает «Готовим ответ…» в ленте до первого фрагмента и убирает после начала стрима', () => {
    const { rerender } = render(<ChatColumn title="Тест" state="thinking" messages={messages} liveSegments={[]} diarization={false} voiceBar={null} />)
    const preparing = screen.getByTestId('reply-preparing')
    expect(preparing).toHaveTextContent('Готовим ответ…')
    // Карточка ответа с шапкой видна сразу, «Готовим ответ…» — внутри пузыря (live-область).
    expect(preparing.querySelector('.msg-head')).toBeTruthy()
    expect(preparing.querySelector('[role="status"]')).toBeTruthy()

    rerender(<ChatColumn title="Тест" state="thinking" messages={messages} liveSegments={[]} diarization={false} voiceBar={null} streamingReply="Первый фрагмент" />)
    expect(screen.queryByTestId('reply-preparing')).not.toBeInTheDocument()
    expect(screen.getByTestId('streaming')).toHaveTextContent('Первый фрагмент')
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

describe('ChatColumn — упрощённая основная шапка', () => {
  it.each(['idle', 'listening', 'transcribing', 'thinking', 'speaking'] as const)(
    'не показывает подпись VoiceState и элементы использования БЗ в состоянии %s',
    (state) => {
      renderCol({ state, aiLabel: 'Codex' })
      const header = document.querySelector('.mhead')
      expect(header).not.toHaveTextContent('Codex думает')
      expect(header).not.toHaveTextContent('Озвучка')
      expect(header?.querySelector('.badge')).not.toBeInTheDocument()
      expect(screen.queryByTestId('kb-usage-open')).not.toBeInTheDocument()
      expect(screen.queryByTestId('kb-usage-live')).not.toBeInTheDocument()
      expect(screen.queryByTestId('kb-usage-count')).not.toBeInTheDocument()
    }
  )

  it('«Откатить правки» у ответа Make со снимком «До правок» (roadmap-2 п.2)', async () => {
    const onMakeRestore = vi.fn()
    const msg = makeAiMessage({ id: 'ai-make', engine: 'codex', meta: { model: 'gpt', makeSnapshotId: 'snap-1' } })
    render(<ChatColumn title="Тест" state="idle" messages={[msg]} liveSegments={[]} diarization={false} voiceBar={null} onMakeRestore={onMakeRestore} />)
    await userEvent.click(screen.getByRole('button', { name: 'Откатить правки' }))
    expect(onMakeRestore).toHaveBeenCalledWith('snap-1')
    cleanup()
    render(<ChatColumn title="Тест" state="idle" messages={[msg]} liveSegments={[]} diarization={false} voiceBar={null} />)
    expect(screen.queryByRole('button', { name: 'Откатить правки' })).toBeNull()
  })

  it('шапка: селект «Навыки» для машины хода запускает навык через onRunSkill', async () => {
    const onRunSkill = vi.fn()
    const machine = { id: 'm1', name: 'Мак', online: true, createdAt: 1, lastSeen: null, policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [{ name: 'логи', command: 'docker logs app' }] } }
    renderCol({ agents: [machine], execTarget: 'm1', onRunSkill })
    await userEvent.selectOptions(screen.getByLabelText('Навыки машины'), 'логи')
    expect(onRunSkill).toHaveBeenCalledWith('m1', 'docker logs app')
  })
})
