import type { RendererApi, RendererMakeBridge } from '@shared/ipc'
import type { EditorContextPayload } from '@shared/types'
import type { ConversationUsage } from '@shared/usageSummary'


export interface MakePaneProps {
  conversationId: string
  api: Pick<RendererApi, 'make:state' | 'make:read' | 'make:write' | 'make:delete' | 'make:rename' | 'make:snapshot' | 'make:restore' | 'make:reset' | 'make:publish' | 'make:unpublish' | 'make:check' | 'make:template' | 'make:upload' | 'make:search' | 'make:stories' | 'make:snapshotDiff' | 'make:restoreFile' | 'make:import' | 'make:importUrl' | 'make:snapshotFile' | 'make:replace' | 'make:shots' | 'make:shot' | 'make:library' | 'make:libraryExport' | 'make:libraryInsert' | 'make:libraryRemove' | 'make:usage' | 'make:cleanup' | 'make:comments' | 'make:commentAdd' | 'make:commentUpdate' | 'make:commentRemove' | 'make:share' | 'make:unshare' | 'make:shareGrant' | 'make:presence' | 'make:tests' | 'make:notes' | 'make:setNotes' | 'make:taskLinks' | 'make:linkTask' | 'make:linkableTasks' | 'make:projectFiles' | 'make:projectLinks' | 'make:projectPull'
  | 'projects:gitWorkspaces' | 'projects:components' | 'projects:componentStories'
  | 'projects:storybookSession' | 'projects:storybookAction'
  | 'projects:gitFile' | 'projects:gitSaveFile' | 'projects:componentTicket'
  | 'projects:storybookOpen' | 'projects:storybookCloseTunnel'>
  make?: RendererMakeBridge
  /** Вставить текст в поле ввода чата (просьба ассистенту про выбранный элемент). */
  onInsertToChat?: (text: string) => void
  /** Отправить сообщение ассистенту сразу (кнопка «Исправить» в баннере ошибок). */
  onAskAssistant?: (text: string) => void
  /** Приложить файл к сообщению чата (скриншот превью). */
  onAttachImage?: (file: File) => void
  /** Открытый файл и выделение — хост подмешивает в следующее сообщение чата (п.21). */
  onEditorContext?: (ctx: EditorContextPayload | null) => void
  /** Расход беседы проекта — суммарная стоимость в шапке (п.24). */
  usage?: ConversationUsage | null
  /** Идёт ход ассистента: на старте снимаем «до», по окончании (после правок) — «после» (roadmap-2 п.8). */
  turnActive?: boolean
  /** Текст последнего запроса пользователя — для самопроверки «Сверить с запросом» (roadmap-4 п.5). */
  lastRequest?: string | null
  /** Режим вопроса (roadmap-4 п.4): следующий ход пойдёт в «План» — только ответ, без правок. */
  askOnly?: boolean
  onAskOnlyChange?: (on: boolean) => void
  /** База превью; по умолчанию — REST.makePreview (тест подменяет). */
  previewBase?: string
  /**
   * Cookie-гейт превью: iframe не умеет слать Bearer, поэтому перед первой загрузкой
   * сервер выпускает preview-cookie (`session:ensurePreview`, как у Web Reader).
   */
  localAgentId?: string | null
  ensurePreview?: () => Promise<boolean>
  /** Открыть карточку связанной задачи на доске (диалог «Задачи проекта»). */
  onOpenTask?: (projectId: string, taskId: string) => void
  /**
   * Проект чата. Есть проект — появляется вкладка «Проект»: компоненты реального
   * репозитория из рабочей копии на машине и Storybook проекта.
   */
  projectId?: string | null
  /** Задержка автосохранения; тесты уменьшают. */
  autosaveDelayMs?: number
}

export interface MakeSharedViewProps {
  token: string
  api: Pick<RendererApi, 'make:shared' | 'make:sharedFile' | 'make:write'>
  ensurePreview?: () => Promise<boolean>
  onBack: () => void
}
