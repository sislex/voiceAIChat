// Нейтральные контракты доменов (CHAT-236).
//
// Здесь живёт то, что нужно двум и более доменам, но не принадлежит ни одному:
// ключи localStorage и форма голосового среза настроек. Благодаря этому модулю
// хранилища не импортируют друг друга даже ради типа.

/** Ключ localStorage для последнего выбранного в сайдбаре проекта. */
export const SIDEBAR_PROJECT_KEY = 'vc.sidebar.project'
/** Ключ localStorage для фильтра «Показывать чаты завершённых задач». */
export const DONE_TASK_CHATS_KEY = 'vc.sidebar.doneTaskChats'
/** Ключ localStorage для межвкладочного обновления meta сообщения. */
export const MESSAGE_META_UPDATE_KEY = 'vc:message-meta-update'
/** Ключ предпочтений для фильтра доски «Показывать завершённые». */
export const BOARD_COMPLETED_KEY = 'vc.board.includeCompleted'
/** Ключ межвкладочного сигнала «настройки изменены» (значение — метка времени). */
export const SETTINGS_UPDATE_KEY = 'vc:settings-update'
/** Ключ предпочтений для ширины сайдбара. */
export const SIDEBAR_WIDTH_KEY = 'vc.sidebar.width'
/**
 * Последняя тема этого браузера: ею рисуется экран входа и старт до ответа
 * сервера, когда неизвестно, кто именно войдёт.
 */
export const THEME_KEY = 'vc.theme'
/**
 * Тема конкретного человека. Общего ключа мало: на одном компьютере работают
 * несколько человек, и после чужого сеанса интерфейс мигал чужой темой, пока
 * не придут настройки с сервера.
 */
export const userThemeKey = (login: string): string => `vc.theme.${encodeURIComponent(login)}`
/** Ключ localStorage для свёрнутого сайдбара на десктопе. */
export const SIDEBAR_COLLAPSED_KEY = 'vc:sidebarCollapsed'
/** Ключ предпочтений для ширины панели превью (в процентах). */
export const PREVIEW_WIDTH_KEY = 'voicechat.previewWidth'
/** Ключ предпочтений «панель ассистента канбана раскрыта». */
export const KANBAN_ASSISTANT_OPEN_KEY = 'voicechat.kanbanAssistantOpen'
/** Ключ предпочтений с чатом ассистента конкретного проекта. */
export const projectAssistantChatKey = (projectId: string): string => `voicechat.projectAssistantChat.${projectId}`
/**
 * Ключ вида и фильтров доски: он общий на пользователя и проект. Версия `v3` —
 * часть контракта хранилища: подняв её, вы обнулите настроенный вид у всех, так
 * что новая версия обязана идти вместе с переносом прежней записи.
 */
export const kanbanFilterKey = (userId: string, projectId: string): string =>
  `voicechat.kanban.filters.v3.${encodeURIComponent(userId)}.${encodeURIComponent(projectId)}`

/** Ключи предпочтений редактора Make: автосохранение, формат при сохранении и раскладка. */
export const MAKE_AUTOSAVE_KEY = 'vc.make.autosave'
export const MAKE_FORMAT_ON_SAVE_KEY = 'vc.make.formatOnSave'
export const MAKE_SPLIT_KEY = 'vc.make.split'
export const MAKE_SPLIT_PCT_KEY = 'vc.make.splitPct'

/** Ключи студии картинок: плотность сетки и недавние промпты (на разговор). */
export const IMAGE_STUDIO_DENSE_KEY = 'vc.imgstudio.dense'
export const imageStudioPromptsKey = (conversationId: string): string => `vc.imgstudio.prompts.${conversationId}`

/**
 * Все ключи предпочтений интерфейса в одном месте — реестр для стража
 * `preferenceKeys.test.ts`. Он не даёт разъехаться двум вещам: одинаковому
 * ключу у разных фич (одна молча затирает другую) и ключу-литералу мимо этого
 * файла (такой не найти при переименовании, и он теряется тихо).
 */
export const PREFERENCE_KEYS = [
  SIDEBAR_PROJECT_KEY,
  DONE_TASK_CHATS_KEY,
  MESSAGE_META_UPDATE_KEY,
  BOARD_COMPLETED_KEY,
  SETTINGS_UPDATE_KEY,
  SIDEBAR_WIDTH_KEY,
  THEME_KEY,
  SIDEBAR_COLLAPSED_KEY,
  PREVIEW_WIDTH_KEY,
  KANBAN_ASSISTANT_OPEN_KEY,
  MAKE_AUTOSAVE_KEY,
  MAKE_FORMAT_ON_SAVE_KEY,
  MAKE_SPLIT_KEY,
  MAKE_SPLIT_PCT_KEY,
  IMAGE_STUDIO_DENSE_KEY
] as const

/**
 * Нормализованный голосовой срез настроек: его отдаёт settingsStore, а
 * потребляет voiceStore. Ни один из них не знает про другой.
 */
export interface EffectiveVoiceSettings {
  micDeviceId: string | null
  voice: string
  handsFree: boolean
  bargeIn: boolean
  autoSpeak: boolean
  diarization: boolean
  showConsole: boolean
}

