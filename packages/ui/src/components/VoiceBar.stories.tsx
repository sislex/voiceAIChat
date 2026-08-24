// Сториз голосовой панели: все состояния голосового цикла и композера. В проде
// половину из них видно секунды (распознавание, «запрос отправлен»), а
// недоступный микрофон вообще зависит от машины пользователя.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import type { PermissionMode, VoiceState } from '@shared/types'
import { VoiceBar } from './VoiceBar'
import { makeUpload } from '../test/fixtures'

const noop = (): void => {}

const meta: Meta<typeof VoiceBar> = {
  title: 'Chat/VoiceBar',
  component: VoiceBar,
  args: {
    state: 'idle',
    draft: '',
    diarization: true,
    detectedSpeakers: [],
    attachments: [],
    onDraftChange: fn(),
    onSubmitText: fn(),
    onStartVoice: fn(),
    onStopVoice: fn(),
    onStopSpeak: fn(),
    onCancelRequest: fn(),
    onAddFiles: fn(),
    onRemoveAttachment: fn(),
    // В приложении панель открывается свёрнутой; витрине нужен обратный дефолт —
    // иначе все состояния композера показывали бы одну и ту же строку-заглушку.
    defaultCollapsed: false
  },
  // Панель живёт внизу колонки чата — на всю её ширину.
  decorators: [(Story) => <div style={{ maxWidth: 860 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof VoiceBar>

/** Простой: композер пуст, кнопка справа — микрофон. */
export const Idle: Story = {}

/** Набранный черновик: микрофон сменился на «отправить». */
export const WithDraft: Story = {
  args: { draft: 'Разберись, почему упал шаг npm test в последнем ране.' }
}

/** Запись: волна, «Готово» и строка обнаруженных говорящих. */
export const Listening: Story = { args: { state: 'listening', detectedSpeakers: [1, 2] } }

/** Запись без диаризации: чипы говорящих становятся общим «Вы». */
export const ListeningWithoutDiarization: Story = {
  args: { state: 'listening', detectedSpeakers: [1], diarization: false }
}

/** Распознавание: транскрипт финализируется, композер ещё заблокирован. */
export const Transcribing: Story = { args: { state: 'transcribing' } }

const waitingInFeedStoryCss = `
  .waiting-in-feed-story { display: grid; min-height: 420px; grid-template-rows: 1fr auto; }
  .waiting-in-feed-story__timeline {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 10px;
    min-height: 260px;
    padding: 20px 14px;
    background: var(--bg);
  }
  .waiting-in-feed-story__message {
    align-self: flex-end;
    max-width: min(76%, 560px);
    padding: 9px 12px;
    border-radius: 14px 14px 4px 14px;
    background: var(--accent);
    color: white;
  }
  .waiting-in-feed-story__preparing {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 26px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .waiting-in-feed-story__dots { letter-spacing: 2px; color: var(--accent); }
`

/** До первого фрагмента подготовка видна в ленте, не увеличивая нижнюю панель. */
export const WaitingForModel: Story = {
  args: { state: 'thinking', draft: 'Следующее сообщение в очередь' },
  render: (args) => (
    <div className="waiting-in-feed-story">
      <style>{waitingInFeedStoryCss}</style>
      <div className="waiting-in-feed-story__timeline" role="log" aria-label="Сообщения">
        <div className="waiting-in-feed-story__message">Проверь, почему последний тест падает только в CI</div>
        <div className="waiting-in-feed-story__preparing" role="status">
          <span className="waiting-in-feed-story__dots" aria-hidden="true">•••</span>
          <span>Готовим ответ…</span>
        </div>
      </div>
      <VoiceBar {...args} />
    </div>
  )
}

/** Пошёл стрим ответа: композер снова доступен под черновик, отправка — нет. */
export const ReplyStreaming: Story = {
  args: { state: 'thinking', replyStarted: true, draft: 'А ещё проверь кэш npm' }
}

/** Озвучка ответа: композер доступен, красная кнопка останавливает речь. */
export const Speaking: Story = { args: { state: 'speaking' } }

/**
 * Микрофон недоступен: движок распознавания не поднялся (нет модели, нет доступа
 * к устройству) — голосовой ввод выключен целиком, кнопки микрофона нет, и в
 * простое панель молчит вместо подсказки про пробел. Текст самой ошибки живёт в
 * баннере ленты (`ChatColumn`, сториз `WithError`).
 */
export const MicUnavailable: Story = { args: { voiceInputEnabled: false } }

const attachmentPreviewStoryCss = `
  .attachment-preview-story .attchips { align-items: flex-end; }
  .attachment-preview-story .attpreview-image {
    background:
      linear-gradient(145deg, transparent 55%, rgba(255,255,255,.22) 56% 64%, transparent 65%),
      radial-gradient(circle at 72% 28%, #ffd166 0 7px, transparent 8px),
      linear-gradient(155deg, #7db7e8 0 48%, #4f8f6a 49% 67%, #315f49 68%);
  }
  .attachment-preview-story .attpreview-image > span { display: none; }
`

/** Изображение показано миниатюрой с именем снизу; прочие файлы остаются чипами. */
export const WithAttachments: Story = {
  decorators: [(Story) => (
    <div className="attachment-preview-story">
      <style>{attachmentPreviewStoryCss}</style>
      <Story />
    </div>
  )],
  args: {
    draft: 'Вот скриншот и лог рана',
    attachments: [
      makeUpload({ name: 'скриншот-падения.png' }),
      makeUpload({ name: 'ci-run-1934.log', mimeType: 'text/plain' })
    ]
  }
}

/** Пустой чат: композер по центру с приветствием. */
export const EmptyCentered: Story = {
  args: { layout: 'centered', draft: '', userDisplayName: 'Анна' }
}

/** Разговор начат: композер закреплён внизу колонки. */
export const ConversationDocked: Story = {
  args: { layout: 'docked', draft: 'Следующее сообщение' }
}

/** Поле начинается с одной строки и растёт на каждую новую строку текста. */
export const Multiline: Story = {
  args: { draft: 'Первая строка\nВторая строка\nТретья строка' }
}

/** После четырёх строк высота ограничена, текст прокручивается внутри поля. */
export const CappedScroll: Story = {
  args: {
    draft: Array.from({ length: 10 }, (_, index) => `Строка ${index + 1}: детали задачи`).join('\n')
  }
}

/** Редактор раскрыт вручную; play оставляет story в раскрытом состоянии. */
export const Expanded: Story = {
  args: { draft: 'Первая строка\nВторая строка\nТретья строка' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByTestId('composer-size-toggle'))
    await expect(canvas.getByLabelText('Поле ввода сообщения').closest('.voicebar')).toHaveClass('voicebar--expanded')
  }
}

/** Изображение обрабатывается: плитка зарезервирована, отправка заблокирована. */
export const AttachmentProcessing: Story = {
  args: {
    draft: 'Посмотри изображение',
    attachments: [{
      localId: 'processing-image',
      status: 'processing',
      name: 'большой-скриншот.png',
      mimeType: 'image/png'
    }]
  }
}

/** Изображение готово и может быть отправлено. */
export const AttachmentReady: Story = {
  decorators: WithAttachments.decorators,
  args: {
    draft: 'Посмотри изображение',
    attachments: [{
      localId: 'ready-image',
      status: 'ready',
      name: 'готовый-скриншот.png',
      mimeType: 'image/png'
    }]
  }
}

/** Ошибка изображения: плитка сохраняется, доступны повтор и удаление. */
export const AttachmentError: Story = {
  args: {
    draft: 'Посмотри изображение',
    onRetryAttachment: fn(),
    attachments: [{
      localId: 'error-image',
      status: 'error',
      name: 'сломанный-скриншот.png',
      mimeType: 'image/png',
      error: 'Не удалось загрузить'
    }]
  }
}

/** Смешанные статусы вложений явно блокируют отправку до устранения проблем. */
export const AttachmentMixedStatuses: Story = {
  args: {
    draft: 'Три изображения',
    onRetryAttachment: fn(),
    attachments: [
      { localId: 'processing', status: 'processing', name: 'обработка.png', mimeType: 'image/png' },
      { localId: 'ready', status: 'ready', name: 'готово.png', mimeType: 'image/png' },
      { localId: 'error', status: 'error', name: 'ошибка.png', mimeType: 'image/png', error: 'Сеть недоступна' }
    ]
  }
}

const queuedTurns = Array.from({ length: 5 }, (_, index) => ({
  id: `queue-${index + 1}`,
  conversationId: 'storybook-chat',
  messageId: `message-${index + 1}`,
  text: index === 1 ? 'Очень длинное ожидающее сообщение, проверяющее перенос текста и доступность действий при увеличенном размере шрифта.' : `Ожидающее сообщение ${index + 1}`,
  attachments: index === 0 ? ['image-upload', 'document-upload'] : [],
  ...(index === 0 ? { attachmentDetails: [
    { uploadId: 'image-upload', path: '/fixtures/image.png', name: 'image.png', mimeType: 'image/png', size: 1024 },
    { uploadId: 'document-upload', path: '/fixtures/document.pdf', name: 'document.pdf', mimeType: 'application/pdf', size: 2048 }
  ] } : {}),
  position: index + 1,
  status: 'queued' as const,
  createdAt: index + 1
}))

function MessageQueueDemo(args: Parameters<typeof VoiceBar>[0]): JSX.Element {
  const [items, setItems] = useState(queuedTurns)

  return (
    <VoiceBar
      {...args}
      queuedTurns={items}
      onEditQueued={(id, text) => {
        setItems((current) => current.map((item) => item.id === id ? { ...item, text } : item))
        args.onEditQueued?.(id, text)
      }}
      onDeleteQueued={(id) => {
        setItems((current) => current
          .filter((item) => item.id !== id)
          .map((item, index) => ({ ...item, position: index + 1 })))
        args.onDeleteQueued?.(id)
      }}
      onSendQueuedNow={(id) => {
        setItems((current) => {
          const selected = current.find((item) => item.id === id)
          if (!selected) return current
          return [selected, ...current.filter((item) => item.id !== id)]
            .map((item, index) => ({ ...item, position: index + 1 }))
        })
        args.onSendQueuedNow?.(id)
      }}
    />
  )
}

/** Свёрнутая очередь показывает первые три элемента и счётчик остальных. */
export const MessageQueue: Story = {
  render: (args) => <MessageQueueDemo {...args} />,
  args: {
    state: 'thinking',
    queuedTurns,
    onEditQueued: fn(),
    onDeleteQueued: fn(),
    onSendQueuedNow: fn()
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByTestId('turn-queue-item')).toHaveLength(3)
    await userEvent.click(canvas.getByRole('button', { name: 'Показать ещё 2' }))
    await expect(canvas.getAllByTestId('turn-queue-item')).toHaveLength(5)
    await userEvent.click(canvas.getByRole('button', { name: 'Отправить сейчас сообщение № 5' }))
    await expect(canvas.getAllByTestId('turn-queue-item')[0]).toHaveTextContent('Ожидающее сообщение 5')
  }
}

/** Мобильный дефолт: очередь доступна, хотя само поле ввода свёрнуто. */
export const MessageQueueCollapsedComposer: Story = {
  args: {
    ...MessageQueue.args,
    defaultCollapsed: true
  },
  parameters: {
    viewport: { defaultViewport: 'mobile1' }
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByLabelText('Поле ввода сообщения')).not.toBeInTheDocument()
    await expect(canvas.getAllByTestId('turn-queue-item')).toHaveLength(3)
    await userEvent.click(canvas.getByRole('button', { name: 'Показать ещё 2' }))
    await expect(canvas.getAllByTestId('turn-queue-item')).toHaveLength(5)
  }
}

/** Ошибка текущего хода оставляет ожидающие элементы на явной паузе. */
export const MessageQueuePausedAfterError: Story = {
  args: { ...MessageQueue.args, queuePaused: true, requestError: 'Движок недоступен' }
}

/**
 * Свёрнутый композер — то, с чего чат открывается: поле убрано в строку, в ней
 * черновик (иначе вложения или состояние хода). Так под ленту сообщений
 * отдаётся вся высота колонки.
 */
export const Collapsed: Story = {
  args: { defaultCollapsed: true, draft: 'Проверь, почему шаг npm test падает только в CI' }
}

/** Свёрнут во время хода: кнопка остановки остаётся в строке, а не прячется. */
export const CollapsedWhileThinking: Story = {
  args: { defaultCollapsed: true, state: 'thinking' }
}

/** Переключатель режима: план / разработка (в простое активен, в ходе заблокирован). */
export const ModeToggle: Story = { args: { permissionMode: 'acceptEdits', onChangePermissionMode: fn() } }

/** Помощник формулировки: варианты подобраны. */
export const PromptHelperReady: Story = {
  args: {
    draft: 'сделай сториз',
    onSuggestPrompts: fn(),
    onApplyPromptSuggestion: fn(),
    onClosePromptSuggestions: fn(),
    promptHelper: {
      open: true,
      loading: false,
      error: null,
      variants: [
        'Покрой сториз виджеты чата и CI-панели, вынеся общие фикстуры.',
        'Добавь Storybook-состояния для ленты чата и панели CI-рана.',
        'Опиши сториз редкие состояния чата: пустая лента, стрим, ошибка движка.'
      ]
    }
  }
}

/** Помощник думает: спиннер вместо списка. */
export const PromptHelperLoading: Story = {
  args: { ...PromptHelperReady.args, promptHelper: { open: true, loading: true, error: null, variants: [] } }
}

/** Помощник не смог: текст ошибки вместо вариантов. */
export const PromptHelperError: Story = {
  args: {
    ...PromptHelperReady.args,
    promptHelper: { open: true, loading: false, error: 'Движок не ответил: истёк таймаут', variants: [] }
  }
}

/** Живая панель со своим состоянием черновика — для play-функций и рук. */
function ControlledVoiceBar({ initial = '', state = 'idle' }: { initial?: string; state?: VoiceState }): JSX.Element {
  const [draft, setDraft] = useState(initial)
  const [sent, setSent] = useState<string[]>([])
  return (
    <div style={{ maxWidth: 860 }}>
      {sent.length > 0 && (
        <ul className="attchips" data-testid="sent-messages">
          {sent.map((text, i) => (
            <li className="attchip" key={i}>{text}</li>
          ))}
        </ul>
      )}
      <VoiceBar
        defaultCollapsed={false}
        state={state}
        draft={draft}
        diarization
        detectedSpeakers={[]}
        attachments={[]}
        onDraftChange={setDraft}
        onSubmitText={() => {
          setSent((prev) => [...prev, draft])
          setDraft('')
        }}
        onStartVoice={noop}
        onStopVoice={noop}
        onStopSpeak={noop}
        onCancelRequest={noop}
        onAddFiles={noop}
        onRemoveAttachment={noop}
      />
    </div>
  )
}

function PermissionModeFirstSendDemo(): JSX.Element {
  const [draft, setDraft] = useState('Создай компонент')
  const [mode, setMode] = useState<PermissionMode>('plan')
  const [sentMode, setSentMode] = useState<PermissionMode | null>(null)

  return (
    <div>
      {sentMode && <p role="status">Первая отправка: {sentMode === 'acceptEdits' ? 'Разработка' : 'План'}</p>}
      <VoiceBar
        defaultCollapsed={false}
        state="idle"
        draft={draft}
        diarization
        detectedSpeakers={[]}
        attachments={[]}
        permissionMode={mode}
        onChangePermissionMode={setMode}
        onDraftChange={setDraft}
        onSubmitText={() => setSentMode(mode)}
        onStartVoice={noop}
        onStopVoice={noop}
        onStopSpeak={noop}
        onCancelRequest={noop}
        onAddFiles={noop}
        onRemoveAttachment={noop}
      />
    </div>
  )
}

/** Выбранный режим разработки применяется уже к первой отправке. */
export const PermissionModeOnFirstSend: Story = {
  render: () => <PermissionModeFirstSendDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Разработка' }))
    await userEvent.click(canvas.getByLabelText('Отправить сообщение'))
    await expect(canvas.getByRole('status')).toHaveTextContent('Первая отправка: Разработка')
  }
}

/**
 * Отправка сообщения: набрать текст → кнопка микрофона сменилась на «отправить» →
 * клик отправляет и очищает поле. Enter делает то же (Shift+Enter — перенос).
 */
export const SendMessage: Story = {
  render: () => <ControlledVoiceBar />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Поле ввода сообщения'), 'Проверь гейт пакета ui')
    await userEvent.click(canvas.getByLabelText('Отправить сообщение'))
    await expect(canvas.getByTestId('sent-messages')).toHaveTextContent('Проверь гейт пакета ui')
    await expect(canvas.getByLabelText('Поле ввода сообщения')).toHaveValue('')
  }
}
