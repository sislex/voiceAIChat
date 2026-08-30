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
/** Ключ предпочтений для ширины сайдбара. */
export const SIDEBAR_WIDTH_KEY = 'vc.sidebar.width'
/** Ключ предпочтений с последней известной темой: до ответа сервера интерфейс рисуется ею. */
export const THEME_KEY = 'vc.theme'
/** Ключ localStorage для свёрнутого сайдбара на десктопе. */
export const SIDEBAR_COLLAPSED_KEY = 'vc:sidebarCollapsed'

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

