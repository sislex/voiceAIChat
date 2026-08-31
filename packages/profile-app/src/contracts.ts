// Порты карточки человека.
//
// Модуль показывают два разных места: админка (чужой профиль, с правом менять) и
// страница «Мой аккаунт» (свой, только чтение). Разницу задают возможности
// (`ProfileCapabilities`) и наличие колбэков, а не флаг `isAdmin` внутри
// разметки: с флагом каждая новая кнопка требует помнить про оба режима.

/** Роль пользователя приложения — зеркало UserRole из общего контракта. */
export type ProfileRole = 'admin' | 'developer' | 'tester' | 'observer'

/** Машина человека: то, что нужно карточке, без деталей протокола агента. */
export interface ProfileMachine {
  id: string
  name: string
  online: boolean
  version?: string
  /** ОС из телеметрии. У офлайн-машины её нет — рисуем прочерк, а не догадку. */
  platform?: string
  osRelease?: string
  lastSeen?: number | null
}

/** Профиль: то, что видно и о себе, и о другом человеке. */
export interface ProfileUser {
  name: string
  role: ProfileRole
  blocked: boolean
  createdAt: number
  email?: string | null
  lastLogin?: number | null
  lastSeenAt?: number | null
  liveSessions?: number
  llmLimitUsd?: number | null
  conversationCount: number
  mustChangePassword?: boolean
  /**
   * Машины человека. Список может быть ещё не загружен (его отдаёт отдельный
   * запрос вкладки), поэтому счётчики приходят рядом: вкладка и быстрые факты
   * показывают число машин, не дожидаясь самого списка.
   */
  machines: ProfileMachine[]
  machinesTotal?: number
  machinesOnline?: number
}

/** Событие журнала безопасности в том виде, в котором его рисует лента. */
export interface ProfileSecurityEvent {
  id: number
  at: number
  type: string
  /** Готовая человеческая подпись типа: сопоставление живёт в securityLabels.ts. */
  label: string
  ip: string
  userAgent: string
  details: string
}

/** Строка расхода по модели. */
export interface ProfileModelSpend {
  model: string
  spendUsd: number
  inputTokens: number
  outputTokens: number
  /** Цена известна не для всех ответов: сумма — нижняя граница, а не точная. */
  incomplete?: boolean
}

/** Точка динамики расхода. */
export interface ProfileSpendPoint {
  bucket: string
  spendUsd: number
}

/** Расход и токены за выбранный период. */
export interface ProfileUsage {
  spendUsd: number
  spendIncomplete?: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  messages: number
  /** Прерванные ходы. Доли «успешных» в системе нет: неудавшийся ход не сохраняется. */
  interrupted?: number
  byModel: ProfileModelSpend[]
  byBucket: ProfileSpendPoint[]
  /** Расход за предыдущий такой же период; нет данных — сравнивать не с чем. */
  previousSpendUsd?: number | null
}

/** Разговор — вторая половина ленты активности. */
export interface ProfileConversation {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

/** Модель провайдера в матрице доступа. */
export interface ProfileModelOption {
  id: string
  label: string
  /** Краткое назначение модели: «Рассуждения и код». */
  note?: string
}

export interface ProfileProvider {
  id: string
  label: string
  models: readonly ProfileModelOption[]
}

/** Запрет: провайдер целиком (`modelId: '*'`) или одна модель. */
export interface ProfileAccessDenial {
  provider: string
  modelId: string
}

/** Что человеку позволено делать на этой карточке. */
export interface ProfileCapabilities {
  canChangeRole: boolean
  canBlock: boolean
  canDelete: boolean
  canSetLimit: boolean
  canEditAccess: boolean
  canUpdateMachines: boolean
  /** Код сброса пароля выдаёт только администратор и только другому человеку. */
  canIssueResetCode: boolean
}

/** Ни одной административной возможности — режим «смотрю на себя». */
export const READ_ONLY: ProfileCapabilities = {
  canChangeRole: false,
  canBlock: false,
  canDelete: false,
  canSetLimit: false,
  canEditAccess: false,
  canUpdateMachines: false,
  canIssueResetCode: false
}

/** Все возможности — режим администратора над чужой учёткой. */
export const FULL_ACCESS: ProfileCapabilities = {
  canChangeRole: true,
  canBlock: true,
  canDelete: true,
  canSetLimit: true,
  canEditAccess: true,
  canUpdateMachines: true,
  canIssueResetCode: true
}

/** Период отчёта по расходу. */
export type ProfilePeriod = 'month' | '7d' | '30d' | 'all'

/** Вкладки карточки. */
export type ProfileTab = 'overview' | 'access' | 'machines' | 'usage' | 'history'

export const PROFILE_TABS: readonly ProfileTab[] = ['overview', 'access', 'machines', 'usage', 'history']

/** Действия, которые карточка отдаёт наружу. Нет колбэка — нет и кнопки. */
export interface ProfileCallbacks {
  onChangeRole?: (role: ProfileRole) => void
  onSetBlocked?: (blocked: boolean, reason: string) => void
  onDelete?: () => void
  onSetLlmLimit?: (limitUsd: number | null) => void
  onSaveAccess?: (denied: ProfileAccessDenial[]) => void
  onUpdateMachine?: (machineId: string) => void
  onIssueResetCode?: () => void
  onSelectPeriod?: (period: ProfilePeriod) => void
  onOpenConversation?: (id: string) => void
  /** Скачивание журнала: файл сохраняет хост — у модуля нет доступа к странице. */
  onExportCsv?: (filename: string, csv: string) => void
  onChangeTab?: (tab: ProfileTab) => void
}
