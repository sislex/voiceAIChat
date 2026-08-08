// Публичный вход общего UI: единый компонент приложения, переиспользуемый
// desktop-renderer и web. Мосты window.* (api/audio/stt/claude/tts) реализует
// каждое приложение по-своему (Electron IPC либо REST+WS) — UI транспорт-нейтрален.
export { default } from './App'
export { default as App } from './App'

// Установка мостов window.* для удалённого режима (REST+WS) — web и desktop-клиент.
export { installRemoteBridges } from './remote'
// Тип живого моста CI: нужен хостам, чтобы объявить window.ci в своём global.d.ts.
export type { RendererCiBridge } from './remote/ciBridge'
export type { RendererKbBridge } from './remote/kbBridge'

// Стили подключаются приложениями через '@voicechat/ui/styles.css' либо напрямую.

export * from './components/prompt-builder/PromptBuilder'
export * from './components/prompt-builder/useAiAssist'
export * from './components/WidgetAssistantFrame'
export * from './components/KanbanAssistant'
