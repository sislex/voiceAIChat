// Сториз голосовой панели: все состояния голосового цикла и композера. В проде
// половину из них видно секунды (распознавание, «запрос отправлен»), а
// недоступный микрофон вообще зависит от машины пользователя.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import type { VoiceState } from '@shared/types'
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

/** Запрос ушёл движку, токенов ещё нет: спиннер и «Остановить запрос». */
export const WaitingForModel: Story = { args: { state: 'thinking' } }

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

/** Вложения: чипы с крестиком «убрать» над строкой ввода. */
export const WithAttachments: Story = {
  args: {
    draft: 'Вот скриншот и лог рана',
    attachments: [makeUpload({ name: 'скриншот-падения.png' }), makeUpload({ name: 'ci-run-1934.log' })]
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

/** Свёрнутая очередь показывает первые три элемента и счётчик остальных. */
export const MessageQueue: Story = {
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
