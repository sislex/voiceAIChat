// Публичная поверхность модуля для хоста.
export { SessionsPanel, SessionsBulkActions, type SessionsPanelProps, type SessionsConfirm } from './SessionsPanel'
export { SessionsDialog, type SessionsDialogProps } from './SessionsDialog'
export { DeviceCard, type DeviceCardProps } from './DeviceCard'
export { createSessionsStore } from './store/sessionsStore'
export type {
  SessionsActions, SessionsCapabilities, SessionsState, SessionsStatus, SessionsStore, SessionsStoreOptions
} from './store/sessionsStore'
export type { SessionsClient, SessionsEvent, SessionsHost, SessionsRealtime } from './contracts'
export { DEFAULT_TEXTS, type SessionsTexts } from './texts'
export { formatDuration, formatMoment, plural } from './format'
export { makeSession, makeSessions } from './fixtures'
