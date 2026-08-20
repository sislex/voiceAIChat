import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { screen } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { VoiceBar } from './VoiceBar'
import '../styles/app.css'

function setup(state: Parameters<typeof VoiceBar>[0]['state'], overrides = {}) {
  const props = makeProps(state, overrides)
  render(<VoiceBar {...props} />)
  return props
}

// В приложении панель открывается свёрнутой; тестам композера нужен обратный
// дефолт — сворачивание проверяет свой describe ниже.
function makeProps(state: Parameters<typeof VoiceBar>[0]['state'], overrides = {}) {
  return {
    defaultCollapsed: false,
    state,
    draft: '',
    diarization: true,
    detectedSpeakers: [1, 2],
    onDraftChange: vi.fn(),
    onSubmitText: vi.fn(),
    onStartVoice: vi.fn(),
    onStopVoice: vi.fn(),
    onStopSpeak: vi.fn(),
    attachments: [],
    onCancelRequest: vi.fn(),
    onAddFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
    ...overrides
  }
}

describe('VoiceBar — выбранная область', () => {
  const previewElement = { tag: 'div', id: 'hero', classes: [], dataAttributes: {}, selector: '#hero', ancestors: ['html', 'body', 'div#hero'], rect: { x: 0, y: 0, top: 0, right: 320, bottom: 120, left: 0, width: 320, height: 120 }, pageUrl: 'https://example.test/page', viewport: { width: 800, height: 600 }, outerHTML: '<div id="hero"></div>', text: '', styles: { font: '', color: '', backgroundColor: '', margin: '', padding: '', border: '', width: '', height: '', position: '', display: '', flex: '', flexDirection: '', flexWrap: '', alignItems: '', justifyContent: '', gap: '', grid: '', gridTemplateColumns: '', gridTemplateRows: '', gridArea: '' } }

  it('показывает удаляемый чип и разрешает отправку без текста', async () => {
    const onRemovePreviewElement = vi.fn()
    setup('idle', { previewElement, onRemovePreviewElement })
    expect(screen.getByTestId('preview-element-chip')).toHaveTextContent('div#hero · example.test')
    expect(screen.getByLabelText('Отправить сообщение')).toBeEnabled()
    await userEvent.click(screen.getByLabelText('Убрать выбранную область'))
    expect(onRemovePreviewElement).toHaveBeenCalledOnce()
  })
})

describe('VoiceBar — состояния', () => {
  it('idle: инпут и кнопка микрофона', () => {
    setup('idle')
    expect(screen.getByLabelText('Поле ввода сообщения')).toBeInTheDocument()
    expect(screen.getByLabelText('Говорить')).toBeInTheDocument()
  })

  it('listening: волна, кнопка стоп, строка обнаруженных спикеров', () => {
    setup('listening')
    expect(screen.getByTestId('wave')).toBeInTheDocument()
    expect(screen.getByLabelText('Остановить запись')).toBeInTheDocument()
    expect(screen.getByTestId('spkline')).toHaveTextContent('Обнаружено говорящих')
    expect(screen.getByText('Спикер 1')).toBeInTheDocument()
    expect(screen.getByText('Спикер 2')).toBeInTheDocument()
  })

  it('ожидание: одна строка и одна кнопка остановки', () => {
    setup('thinking')
    expect(screen.getByTestId('request-status')).toHaveTextContent('Готовим ответ…')
    expect(screen.getAllByLabelText('Остановить ответ')).toHaveLength(1)
    expect(screen.queryByText(/Текст передан движку/)).not.toBeInTheDocument()
  })

  it('ожидание: имя движка из aiLabel (Codex)', () => {
    setup('thinking', { aiLabel: 'Codex' })
    expect(screen.getByTestId('request-status')).toHaveTextContent('Готовим ответ…')
  })

  it('speaking: поле ввода и отправка в очередь доступны, есть стоп озвучки', () => {
    setup('speaking', { draft: 'следующий вопрос' })
    expect(screen.getByLabelText('Поле ввода сообщения')).toBeInTheDocument()
    expect(screen.getByLabelText('Добавить сообщение в очередь')).toBeEnabled()
    expect(screen.getByLabelText('Остановить озвучку')).toBeInTheDocument()
  })

  it('стриминг: поле ввода и отправка в очередь доступны, есть стоп запроса', () => {
    setup('thinking', { replyStarted: true, draft: 'следующий вопрос' })
    expect(screen.getByLabelText('Поле ввода сообщения')).toBeInTheDocument()
    expect(screen.getByLabelText('Добавить сообщение в очередь')).toBeEnabled()
    expect(screen.getByLabelText('Остановить ответ')).toBeInTheDocument()
    expect(screen.getByTestId('request-status')).toHaveTextContent('Claude формирует ответ…')
  })

  it('стриминг: Enter ставит сообщение в очередь', async () => {
    const props = setup('thinking', { replyStarted: true, draft: 'привет' })
    screen.getByLabelText('Поле ввода сообщения').focus()
    await userEvent.keyboard('{Enter}')
    expect(props.onSubmitText).toHaveBeenCalledOnce()
  })

  it('отправка сразу показывает начальный этап', async () => {
    setup('idle', { draft: 'привет' })
    await userEvent.click(screen.getByLabelText('Отправить сообщение'))
    expect(screen.getByTestId('request-status')).toHaveTextContent('Запрос отправляется…')
  })

  it('повторные realtime-события обновляют единственную строку без дублей', () => {
    const base = makeProps('thinking', { aiLabel: 'Codex' })
    const { rerender } = render(<VoiceBar {...base} />)
    rerender(<VoiceBar {...base} replyStarted />)
    rerender(<VoiceBar {...base} replyStarted />)
    expect(screen.getAllByTestId('request-status')).toHaveLength(1)
    expect(screen.getByTestId('request-status')).toHaveTextContent('Codex формирует ответ…')
    expect(screen.getAllByLabelText('Остановить ответ')).toHaveLength(1)
  })

  it('на мобильной ширине текст сжимается, а кнопка остаётся видимой', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    setup('thinking', { aiLabel: 'Очень длинное имя движка' })
    const status = screen.getByTestId('request-status')
    expect(status.querySelector('.request-status__text')).toBeInTheDocument()
    expect(status.querySelector('.request-status__stop')).toBeVisible()
    expect(screen.getAllByTestId('request-status')).toHaveLength(1)
  })

  it('повторный клик отменяет ход ровно один раз и блокирует кнопку', async () => {
    const props = setup('thinking')
    const stop = screen.getByLabelText('Остановить ответ')
    await userEvent.dblClick(stop)
    expect(props.onCancelRequest).toHaveBeenCalledOnce()
    expect(stop).toBeDisabled()
    expect(screen.getByTestId('request-status')).toHaveTextContent('Останавливаем запрос…')
  })

  it('кнопка остановки доступна с клавиатуры', async () => {
    const props = setup('thinking')
    screen.getByLabelText('Остановить ответ').focus()
    await userEvent.keyboard('{Enter}')
    expect(props.onCancelRequest).toHaveBeenCalledOnce()
  })

  it('после завершения убирает строку и возвращает обычный композер', () => {
    const active = makeProps('thinking')
    const { rerender } = render(<VoiceBar {...active} />)
    rerender(<VoiceBar {...active} state="idle" />)
    expect(screen.queryByTestId('request-status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Говорить')).toBeInTheDocument()
  })

  it('ошибка и отмена показывают итоговые состояния', async () => {
    const active = makeProps('thinking')
    const { rerender, unmount } = render(<VoiceBar {...active} />)
    rerender(<VoiceBar {...active} state="idle" requestError="boom" />)
    expect(screen.getByTestId('request-status')).toHaveTextContent('Ошибка выполнения')
    unmount()

    const stopped = makeProps('thinking')
    const view = render(<VoiceBar {...stopped} />)
    await userEvent.click(screen.getByLabelText('Остановить ответ'))
    view.rerender(<VoiceBar {...stopped} state="idle" />)
    expect(screen.getByTestId('request-status')).toHaveTextContent('Запрос остановлен')
  })

  it('diarization off: подпись «Вы» вместо «Спикер N»', () => {
    setup('listening', { diarization: false, detectedSpeakers: [1] })
    expect(screen.getByText('Вы')).toBeInTheDocument()
    expect(screen.queryByText('Спикер 1')).not.toBeInTheDocument()
  })

  it('клик по микрофону вызывает onStartVoice', async () => {
    const props = setup('idle')
    await userEvent.click(screen.getByLabelText('Говорить'))
    expect(props.onStartVoice).toHaveBeenCalledOnce()
  })

  it('при глобальной блокировке кнопки микрофона и текста о недоступности нет', () => {
    setup('idle', { voiceInputEnabled: false })
    expect(screen.queryByLabelText('Говорить')).not.toBeInTheDocument()
    expect(screen.queryByText('Голосовой ввод временно недоступен')).not.toBeInTheDocument()
  })

  it('непустой инпут: кнопка «Отправить» вместо микрофона, клик → onSubmitText', async () => {
    const props = setup('idle', { draft: 'привет' })
    expect(screen.queryByLabelText('Говорить')).not.toBeInTheDocument()
    const sendBtn = screen.getByLabelText('Отправить сообщение')
    await userEvent.click(sendBtn)
    expect(props.onSubmitText).toHaveBeenCalledOnce()
  })

  it('кнопка «Отправить» появляется и при наличии только вложений', () => {
    setup('idle', { attachments: [{ id: 'a1', name: 'file.txt' }] })
    expect(screen.getByLabelText('Отправить сообщение')).toBeInTheDocument()
  })

  it('Enter в непустом инпуте вызывает onSubmitText', async () => {
    const props = setup('idle', { draft: 'привет' })
    const input = screen.getByLabelText('Поле ввода сообщения')
    input.focus()
    await userEvent.keyboard('{Enter}')
    expect(props.onSubmitText).toHaveBeenCalledOnce()
  })

  it('Enter в пустом инпуте ничего не отправляет', async () => {
    const props = setup('idle', { draft: '   ' })
    screen.getByLabelText('Поле ввода сообщения').focus()
    await userEvent.keyboard('{Enter}')
    expect(props.onSubmitText).not.toHaveBeenCalled()
  })
})

describe('VoiceBar — высота поля ввода', () => {
  // В jsdom нет раскладки: задаём метрики поля стилем и подменяем scrollHeight так,
  // будто текст занял свои строки. Строка — 20px, паддинги 10+10, рамка 1+1.
  const LINE = 20
  const PAD = 20

  beforeEach(() => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<style id="tin-metrics">.tin{line-height:20px;padding:10px 16px;border:1px solid #000}</style>'
    )
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return Math.max(1, this.value.split('\n').length) * LINE + PAD
      }
    })
  })

  afterEach(() => {
    document.getElementById('tin-metrics')?.remove()
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight
  })

  function heightOf(draft: string): string {
    const { unmount } = render(<VoiceBar {...makeProps('idle', { draft })} />)
    const height = (screen.getByLabelText('Поле ввода сообщения') as HTMLTextAreaElement).style.height
    unmount()
    return height
  }

  it('поле открывается на двух строках', () => {
    setup('idle')
    expect(screen.getByLabelText('Поле ввода сообщения')).toHaveAttribute('rows', '2')
  })

  it('одна строка текста всё равно даёт высоту двух строк', () => {
    expect(heightOf('привет')).toBe('62px') // 2*20 + 20 + рамка 2
  })

  it('высота идёт за числом строк: 3 и 4 строки', () => {
    expect(heightOf('a\nb\nc')).toBe('82px')
    expect(heightOf('a\nb\nc\nd')).toBe('102px')
  })

  it('после четырёх строк не растёт — дальше скролл', () => {
    expect(heightOf('a\nb\nc\nd\ne')).toBe('102px')
    expect(heightOf('a\nb\nc\nd\ne\nf\ng\nh')).toBe('102px')
  })
})


describe('VoiceBar — быстрый режим', () => {
  it('переключает План на Разработку', async () => {
    const onChangePermissionMode = vi.fn()
    setup('idle', { permissionMode: 'plan', onChangePermissionMode })
    expect(screen.getByRole('button', { name: 'План' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Разработка' }))
    expect(onChangePermissionMode).toHaveBeenCalledWith('acceptEdits')
  })

  it('блокирует переключение во время хода', () => {
    setup('thinking', { permissionMode: 'plan', onChangePermissionMode: vi.fn() })
    expect(screen.getByRole('button', { name: 'Разработка' })).toBeDisabled()
  })
})

describe('VoiceBar — помощник промптов', () => {
  const openHelper = { open: true, loading: false, variants: ['Вариант A', 'Вариант B'], error: null }

  it('палочка появляется только когда в черновике есть текст', () => {
    const { rerender } = render(<VoiceBar {...makeProps('idle', { draft: '', onSuggestPrompts: vi.fn() })} />)
    expect(screen.queryByLabelText('Подсказать формулировку запроса')).not.toBeInTheDocument()
    rerender(<VoiceBar {...makeProps('idle', { draft: 'сделай форму', onSuggestPrompts: vi.fn() })} />)
    expect(screen.getByLabelText('Подсказать формулировку запроса')).toBeInTheDocument()
  })

  it('клик по палочке запрашивает варианты', async () => {
    const onSuggestPrompts = vi.fn()
    setup('idle', { draft: 'сделай форму', onSuggestPrompts })
    await userEvent.click(screen.getByLabelText('Подсказать формулировку запроса'))
    expect(onSuggestPrompts).toHaveBeenCalledOnce()
  })

  it('показывает варианты и заполняет черновик по клику', async () => {
    const onApplyPromptSuggestion = vi.fn()
    setup('idle', { draft: 'сделай форму', promptHelper: openHelper, onSuggestPrompts: vi.fn(), onApplyPromptSuggestion })
    expect(screen.getByTestId('prompt-helper')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Вариант B' }))
    expect(onApplyPromptSuggestion).toHaveBeenCalledWith('Вариант B')
  })

  it('открытая палочка закрывает панель повторным кликом', async () => {
    const onClosePromptSuggestions = vi.fn()
    setup('idle', { draft: 'сделай форму', promptHelper: openHelper, onSuggestPrompts: vi.fn(), onClosePromptSuggestions })
    await userEvent.click(screen.getByLabelText('Подсказать формулировку запроса'))
    expect(onClosePromptSuggestions).toHaveBeenCalledOnce()
  })

  it('крестик закрывает панель', async () => {
    const onClosePromptSuggestions = vi.fn()
    setup('idle', { draft: 'x', promptHelper: openHelper, onSuggestPrompts: vi.fn(), onClosePromptSuggestions })
    await userEvent.click(screen.getByLabelText('Закрыть варианты'))
    expect(onClosePromptSuggestions).toHaveBeenCalledOnce()
  })

  it('показывает индикатор загрузки и текст ошибки', () => {
    const { rerender } = render(
      <VoiceBar {...makeProps('idle', { draft: 'x', promptHelper: { open: true, loading: true, variants: [], error: null }, onSuggestPrompts: vi.fn() })} />
    )
    expect(screen.getByText('Подбираю варианты…')).toBeInTheDocument()
    rerender(
      <VoiceBar {...makeProps('idle', { draft: 'x', promptHelper: { open: true, loading: false, variants: [], error: 'Сбой' }, onSuggestPrompts: vi.fn() })} />
    )
    expect(screen.getByText('Сбой')).toBeInTheDocument()
  })
})

describe('VoiceBar — сворачивание композера', () => {
  it('панель открывается свёрнутой: поля ввода и микрофона нет, есть строка-заглушка', () => {
    render(<VoiceBar {...makeProps('idle', { defaultCollapsed: undefined })} />)
    expect(screen.queryByLabelText('Поле ввода сообщения')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Говорить')).not.toBeInTheDocument()
    expect(screen.getByTestId('composer-expand')).toHaveTextContent('Показать поле ввода')
  })

  it('разворачивается с фокусом и сворачивается обратно без потери содержимого', async () => {
    setup('idle', { draft: 'черновик', attachments: [{ id: 'a1', name: 'лог.txt' }] })
    await userEvent.click(screen.getByLabelText('Свернуть поле ввода'))
    expect(screen.queryByLabelText('Поле ввода сообщения')).not.toBeInTheDocument()
    expect(screen.getByTestId('composer-expand')).toHaveTextContent('черновик')

    await userEvent.click(screen.getByTestId('composer-expand'))
    expect(screen.getByLabelText('Поле ввода сообщения')).toHaveFocus()
    expect(screen.getByLabelText('Поле ввода сообщения')).toHaveValue('черновик')
    expect(screen.getByTestId('attachments')).toHaveTextContent('лог.txt')
  })

  it('в строке видно, что осталось в композере: черновик, иначе вложения', async () => {
    const { unmount } = render(<VoiceBar {...makeProps('idle', { draft: 'проверь шаг npm test' })} />)
    await userEvent.click(screen.getByLabelText('Свернуть поле ввода'))
    expect(screen.getByTestId('composer-expand')).toHaveTextContent('проверь шаг npm test')
    unmount()

    render(<VoiceBar {...makeProps('idle', { defaultCollapsed: true, attachments: [{ id: 'a1', name: 'лог.txt' }] })} />)
    expect(screen.getByTestId('composer-expand')).toHaveTextContent('Вложений: 1')
  })

  it('свёрнутая панель не прячет остановку хода и запись объявляет читалке', async () => {
    const props = makeProps('thinking', {})
    const { unmount } = render(<VoiceBar {...props} />)
    await userEvent.click(screen.getByLabelText('Свернуть поле ввода'))
    await userEvent.click(screen.getByLabelText('Остановить ответ'))
    expect(props.onCancelRequest).toHaveBeenCalledOnce()
    expect(screen.getByTestId('voice-announce')).toHaveTextContent('Запрос отправлен движку Claude, ждём ответ')
    unmount()

    const listening = makeProps('listening', {})
    render(<VoiceBar {...listening} />)
    await userEvent.click(screen.getByLabelText('Остановить запись'))
    expect(listening.onStopVoice).toHaveBeenCalledOnce()
  })

  it('изменение defaultCollapsed после ручного выбора не перезаписывает состояние', async () => {
    const { rerender } = render(<VoiceBar {...makeProps('idle', { defaultCollapsed: false })} />)
    await userEvent.click(screen.getByLabelText('Свернуть поле ввода'))
    rerender(<VoiceBar {...makeProps('idle', { defaultCollapsed: false })} />)
    expect(screen.getByTestId('composer-expand')).toBeInTheDocument()
  })

  it('развёрнутое состояние не запоминается: следующее монтирование снова свёрнуто', async () => {
    const { unmount } = render(<VoiceBar {...makeProps('idle', { defaultCollapsed: undefined })} />)
    await userEvent.click(screen.getByTestId('composer-expand'))
    expect(screen.getByLabelText('Поле ввода сообщения')).toBeInTheDocument()
    unmount()

    render(<VoiceBar {...makeProps('idle', { defaultCollapsed: undefined })} />)
    expect(screen.getByTestId('composer-expand')).toBeInTheDocument()
    expect(screen.queryByLabelText('Поле ввода сообщения')).not.toBeInTheDocument()
  })
})

describe('VoiceBar — доступность', () => {
  it.each(['idle', 'listening', 'thinking', 'speaking'] as const)('без нарушений axe: %s', async (state) => {
    setup(state, { draft: 'привет', onChangePermissionMode: vi.fn() })
    await expectNoViolations()
    expectLabelledIconButtons()
  })

  it('без нарушений axe: свёрнутый композер', async () => {
    setup('thinking', { draft: 'привет' })
    await userEvent.click(screen.getByLabelText('Свернуть поле ввода'))
    await expectNoViolations()
    expectLabelledIconButtons()
  })

  it('без нарушений axe: панель вариантов формулировки', async () => {
    setup('idle', { draft: 'привет', onSuggestPrompts: vi.fn(), promptHelper: { open: true, loading: false, variants: ['Первый', 'Второй'], error: null } })
    await expectNoViolations()
  })
})

describe('VoiceBar — серверная очередь', () => {
  const item = { id: 'q1', conversationId: 'c1', messageId: 'm2', text: 'Следующий вопрос', attachments: ['f1'], position: 1, status: 'queued' as const, createdAt: 1 }
  const items = Array.from({ length: 5 }, (_, index) => ({ ...item, id: `q${index + 1}`, messageId: `m${index + 1}`, text: `Вопрос ${index + 1}`, attachments: [], position: index + 1 }))

  it('показывает текст, позицию, вложения и паузу только после ошибки', () => {
    setup('thinking', { queuedTurns: [item], queuePaused: true })
    expect(screen.getByTestId('turn-queue')).toHaveTextContent('В очереди · 1')
    expect(screen.getByTestId('turn-queue-item')).toHaveTextContent('№ 1 · Ожидает')
    expect(screen.getByTestId('turn-queue-item')).toHaveTextContent('Следующий вопрос')
    expect(screen.getByTestId('turn-queue-item')).toHaveTextContent('Вложение 1')
    expect(screen.getByText('Очередь остановлена после ошибки')).toHaveAttribute('role', 'status')
  })

  it('сворачивает очередь до трёх элементов и раскрывает ограниченный список', async () => {
    setup('thinking', { queuedTurns: items })
    expect(screen.getAllByTestId('turn-queue-item')).toHaveLength(3)
    const toggle = screen.getByRole('button', { name: 'Показать ещё 2' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(screen.getAllByTestId('turn-queue-item')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Свернуть очередь' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('вызывает удаление и повышение приоритета выбранного элемента', async () => {
    const onDeleteQueued = vi.fn()
    const onSendQueuedNow = vi.fn()
    setup('thinking', { queuedTurns: [item], onDeleteQueued, onSendQueuedNow })
    await userEvent.click(screen.getByRole('button', { name: 'Удалить сообщение № 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Отправить сейчас сообщение № 1' }))
    expect(onDeleteQueued).toHaveBeenCalledWith('q1')
    expect(onSendQueuedNow).toHaveBeenCalledWith('q1')
  })

  it('редактирует вопрос на месте без window.prompt', async () => {
    const onEditQueued = vi.fn()
    setup('thinking', { queuedTurns: [item], onEditQueued })
    await userEvent.click(screen.getByRole('button', { name: 'Редактировать сообщение № 1' }))
    const input = screen.getByLabelText('Текст ожидающего сообщения')
    await userEvent.clear(input)
    await userEvent.type(input, 'Новая формулировка')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onEditQueued).toHaveBeenCalledWith('q1', 'Новая формулировка')
    expect(screen.getAllByTestId('turn-queue-item')).toHaveLength(1)
  })
})

describe('VoiceBar — объявления для скринридера', () => {
  it('запись и ход модели объявляются, простой — молчит', () => {
    setup('listening')
    const live = screen.getByTestId('voice-announce')
    expect(live).toHaveAttribute('role', 'status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveTextContent('Идёт запись, говорите')
  })

  it('в простое живая область пуста: подсказку про пробел читалка не повторяет', () => {
    setup('idle')
    expect(screen.getByTestId('voice-announce')).toBeEmptyDOMElement()
  })

  it('во время хода модели объявляет, кому ушёл запрос', () => {
    setup('thinking', { aiLabel: 'Codex' })
    expect(screen.getByTestId('voice-announce')).toHaveTextContent('Запрос отправлен движку Codex, ждём ответ')
  })
})
