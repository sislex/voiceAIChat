// Публичный вход общего UI: единый компонент приложения, переиспользуемый
// desktop-renderer и web. Мосты window.* (api/audio/stt/claude/tts) реализует
// каждое приложение по-своему (Electron IPC либо REST+WS) — UI транспорт-нейтрален.
export { default } from './App'
export { default as App } from './App'

// Установка мостов window.* для удалённого режима (REST+WS) — web и desktop-клиент.
export { installRemoteBridges } from './remote'
export { createApplication } from './createApplication.js'
export type { CreateApplicationOptions } from './createApplication.js'
export { createModuleRegistry } from './moduleRegistry.js'
export { createBrowserAdapters, emptySettingsSnapshot } from './adapters/index.js'
export type { BrowserAdapterInput } from './adapters/index.js'
export { ApplicationProvider, AppShell } from '@voicechat/app-shell'
export type { AppModule, ApplicationPorts, AppShellHost, AppRuntime } from '@voicechat/app-shell'
// Тип живого моста CI: нужен хостам, чтобы объявить window.ci в своём global.d.ts.
export type { RendererCiBridge } from './remote/ciBridge'
export type { RendererFeaturePreviewBridge } from './remote/featurePreviewBridge'
export type { RendererQaBridge } from './remote/qaBridge'
export type { RendererKbBridge } from './remote/kbBridge'
export { createProjectsClient } from './projects/createProjectsClient'

// Стили подключаются приложениями через '@voicechat/ui/styles.css' либо напрямую.

export * from './components/prompt-builder/PromptBuilder'
export * from './components/prompt-builder/useAiAssist'
export * from './components/WidgetAssistantFrame'
export * from './components/KanbanAssistant'
