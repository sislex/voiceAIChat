// Публичный вход общего UI: единый компонент приложения, переиспользуемый
// desktop-renderer и web. Мосты window.* (api/audio/stt/claude/tts) реализует
// каждое приложение по-своему (Electron IPC либо REST+WS) — UI транспорт-нейтрален.
export { default } from './App'
export { default as App } from './App'

// Стили подключаются приложениями через '@voicechat/ui/styles.css' либо напрямую.
