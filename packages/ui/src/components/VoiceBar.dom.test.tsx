import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

function makeProps(state: Parameters<typeof VoiceBar>[0]['state'], overrides = {}) {
  return {
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

  it('thinking: карточка «Запрос отправлен…»', () => {
    setup('thinking')
    expect(screen.getByText('Запрос отправлен движку Claude…')).toBeInTheDocument()
  })

  it('thinking: имя движка из aiLabel (Codex)', () => {
    setup('thinking', { aiLabel: 'Codex' })
    expect(screen.getByText('Запрос отправлен движку Codex…')).toBeInTheDocument()
  })

  it('speaking: поле ввода доступно, «Отправить» неактивна, есть стоп озвучки', () => {
    setup('speaking')
    expect(screen.getByLabelText('Поле ввода сообщения')).toBeInTheDocument()
    expect(screen.getByLabelText('Отправить сообщение')).toBeDisabled()
    expect(screen.getByLabelText('Остановить озвучку')).toBeInTheDocument()
  })

  it('стриминг (replyStarted): поле ввода доступно, «Отправить» неактивна, есть стоп запроса', () => {
    setup('thinking', { replyStarted: true, draft: 'следующий вопрос' })
    expect(screen.getByLabelText('Поле ввода сообщения')).toBeInTheDocument()
    expect(screen.getByLabelText('Отправить сообщение')).toBeDisabled()
    expect(screen.getByLabelText('Остановить запрос')).toBeInTheDocument()
  })

  it('стриминг: Enter не отправляет (отправка только в idle)', async () => {
    const props = setup('thinking', { replyStarted: true, draft: 'привет' })
    screen.getByLabelText('Поле ввода сообщения').focus()
    await userEvent.keyboard('{Enter}')
    expect(props.onSubmitText).not.toHaveBeenCalled()
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
