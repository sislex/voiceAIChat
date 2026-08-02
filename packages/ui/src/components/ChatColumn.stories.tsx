// Сториз колонки чата — самого насыщенного состояниями экрана. До этих сториз
// пустую беседу, стриминг с действиями, обрыв хода, баннер отсутствующей модели
// и правку сообщения приходилось воспроизводить живым агентом в проде.
//
// Голосовая панель внизу — настоящий `VoiceBar` (у него свои сториз): так видно
// геометрию всей колонки, а не одной ленты.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import type { Message, VoiceState } from '@shared/types'
import { ChatColumn } from './ChatColumn'
import { VoiceBar } from './VoiceBar'
import {
  ACTIVITY_INTERLEAVED,
  ACTIVITY_LIVE,
  MD_KITCHEN_SINK,
  STREAMING_TEXT,
  T0,
  TEXT_WITH_ACTIVITY,
  makeAgent,
  makeAiMessage,
  makeImageMessage,
  makeLiveSegments,
  makeLongThread,
  makeMachineOps,
  makeQuestionsMessage,
  makeToolMessage,
  makeTurnMeta,
  makeUsage,
  makeUserMessage,
  makeOfflineAgent
} from '../test/fixtures'

const noop = (): void => {}

/** Голосовая панель в том состоянии, в котором находится колонка. */
function bar(state: VoiceState = 'idle'): JSX.Element {
  return (
    <VoiceBar
      defaultCollapsed={false}
      state={state}
      draft=""
      diarization
      detectedSpeakers={state === 'listening' ? [1, 2] : []}
      attachments={[]}
      onDraftChange={noop}
      onSubmitText={noop}
      onStartVoice={noop}
      onStopVoice={noop}
      onStopSpeak={noop}
      onCancelRequest={noop}
      onAddFiles={noop}
      onRemoveAttachment={noop}
    />
  )
}

const agents = [makeAgent({ id: 'm1', name: 'MacBook' }), makeOfflineAgent({ id: 'm2', name: 'Сборочный сервер' })]

/** Обычная переписка: вопрос, ответ с действиями и метой хода. */
function thread(): Message[] {
  return [
    makeUserMessage({ id: 'u1', text: 'Почему на последнем ране упал шаг с тестами?', execTarget: 'm1' }),
    makeAiMessage({
      id: 'a1',
      text: TEXT_WITH_ACTIVITY,
      execTarget: 'm1',
      createdAt: T0 + 45_000,
      meta: makeTurnMeta({ activity: ACTIVITY_INTERLEAVED, durationMs: 45_000, costUsd: 0.183, inputTokens: 82_400, outputTokens: 1_240 })
    })
  ]
}

const meta: Meta<typeof ChatColumn> = {
  title: 'Chat/ChatColumn',
  component: ChatColumn,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Разбор упавшего рана',
    state: 'idle',
    messages: thread(),
    liveSegments: [],
    diarization: true,
    agents,
    execTarget: 'm1',
    aiLabel: 'Claude',
    canSpeak: true,
    permissionMode: 'acceptEdits',
    voiceBar: bar(),
    onSpeakMessage: fn(),
    onDeleteMessage: fn(),
    onEditMessage: fn(),
    onExport: fn(),
    onRenameTitle: fn(),
    onOpenConversationSettings: fn(),
    onChangeExecTarget: fn()
  },
  // Колонка чата — грид на всю высоту: без явной высоты лента не скроллится.
  decorators: [(Story) => <div className="app" style={{ height: '90vh', display: 'grid' }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof ChatColumn>

/** Обычная беседа: свои реплики слева, ответы модели с подписями и мета-иконкой. */
export const Conversation: Story = {}

/** Пустая беседа: подсказка объясняет следующий шаг, а не констатирует пустоту. */
export const EmptyConversation: Story = { args: { messages: [], onExport: undefined } }

/** Первая загрузка истории: скелетон реплик той же геометрии, что у сообщений. */
export const LoadingMessages: Story = { args: { messages: [], loadingMessages: true } }

/** Повторная загрузка: лента остаётся на месте, сверху — индикатор обновления. */
export const RefreshingMessages: Story = { args: { loadingMessages: true } }

/**
 * Стриминг ответа: токены идут, действия чередуются с текстом, внизу пузыря
 * дубль статуса — при длинном ответе верхняя строка уезжает из вида.
 */
export const Streaming: Story = {
  args: {
    state: 'thinking',
    streamingReply: STREAMING_TEXT,
    liveActivity: ACTIVITY_LIVE,
    liveUsage: makeUsage(),
    voiceBar: bar('thinking')
  }
}

/** Запрос ушёл, токенов ещё нет: блок «обрабатывает запрос» с живой активностью. */
export const Thinking: Story = {
  args: { state: 'thinking', liveActivity: ACTIVITY_LIVE, liveUsage: makeUsage(), voiceBar: bar('thinking') }
}

/** Запись голоса: живой транскрипт по говорящим над композером. */
export const Listening: Story = {
  args: { state: 'listening', liveSegments: makeLiveSegments(), voiceBar: bar('listening') }
}

/** Ошибка движка баннером над лентой (закрывается крестиком). */
export const WithError: Story = {
  args: {
    error: 'Микрофон недоступен: браузер не дал доступ к устройству записи',
    onDismissError: fn()
  }
}

/** Модель распознавания не скачана — баннер первого запуска с кнопкой. */
export const ModelMissing: Story = {
  args: { modelMissing: true, modelLabel: 'large-v3-turbo', onDownloadModel: fn() }
}

/** Скачивание модели идёт: вместо кнопки — процент. */
export const ModelDownloading: Story = {
  args: { modelMissing: true, modelLabel: 'large-v3-turbo', downloading: true, downloadPercent: 42 }
}

/** Уточняющие вопросы модели: форма ответов под последним сообщением. */
export const WithQuestions: Story = {
  args: { messages: [makeUserMessage({ text: 'Сделай CI-шаг для витрины' }), makeQuestionsMessage()], onAnswerQuestions: fn() }
}

/** Вопрос CI-рана, продублированный в чат: ответ уйдёт в ран, а не новым ходом. */
export const WithCiQuestion: Story = {
  args: {
    messages: [
      makeUserMessage({ text: 'старт' }),
      makeQuestionsMessage({ id: 'a-ci', meta: { ciInteraction: { runId: 'run-1', interactionId: 'it-1' } } }),
      makeUserMessage({ id: 'u-after', text: 'а пока посмотрю лог' })
    ],
    onAnswerCiInteraction: fn()
  }
}

/** Ответ с картинкой и встроенной консолью машины (оба блока вырезаны из текста). */
export const WithMachineWidgets: Story = {
  args: {
    messages: [makeUserMessage({ text: 'Построй график и открой консоль' }), makeImageMessage(), makeToolMessage('console')],
    machineOps: makeMachineOps(),
    onOpenTerminal: fn(),
    onOpenImageInExplorer: fn()
  }
}

/** Плановый ответ: под ним предложение выполнить тот же запрос в разработке. */
export const PlanReady: Story = {
  args: {
    permissionMode: 'plan',
    messages: [
      makeUserMessage({ text: 'Составь план' }),
      makeAiMessage({
        id: 'a-plan',
        text: MD_KITCHEN_SINK,
        meta: makeTurnMeta({ request: { ...makeTurnMeta().request!, permissionMode: 'plan' } })
      })
    ],
    onExecutePlan: fn(),
    voiceBar: bar()
  }
}

/** Ход прерван перезапуском сервера: сохранена набранная часть, есть пометка. */
export const InterruptedAnswer: Story = {
  args: {
    messages: [
      makeUserMessage({ text: 'Опиши архитектуру' }),
      makeAiMessage({ id: 'a-int', text: 'Начал описывать, но не успел закон', meta: makeTurnMeta({ interrupted: true }) })
    ]
  }
}

/** Длинная переписка: 24 сообщения — скролл и автоскролл вниз. */
export const LongThread: Story = { args: { messages: makeLongThread() } }

/** Телефон: сайдбар выдвижной, поэтому в шапке появляется ☰. */
export const MobileViewport: Story = {
  args: { onToggleSidebar: fn() },
  parameters: { viewport: { defaultViewport: 'mobile2' } }
}

/**
 * Правка своей реплики: ✏️ открывает поле на месте пузыря (2–4 строки),
 * «Отправить» перезапускает ход с новым текстом.
 */
export const EditingMessage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Изменить сообщение'))
    const area = canvas.getByLabelText('Редактирование сообщения')
    await userEvent.clear(area)
    await userEvent.type(area, 'Почему упал шаг npm test и как это починить?')
    await expect(area).toHaveValue('Почему упал шаг npm test и как это починить?')
    await expect(canvas.getByRole('button', { name: 'Отправить' })).toBeEnabled()
  }
}

/** Переключение вида действий у ответа: минимально → кратко → подробно. */
export const ActivityModeSwitch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByLabelText('Переключить вид действий')
    await userEvent.click(button)
    // Секций действий в ответе две (по обе стороны абзацев) — обе сворачиваются
    // в свою строку-сводку, поэтому здесь `getAllBy`, а не `getBy`.
    await expect(canvas.getAllByTestId('activity-brief')).toHaveLength(2)
    await userEvent.click(button)
    await expect(canvas.getAllByTestId('activity-section').length).toBeGreaterThan(1)
  }
}
