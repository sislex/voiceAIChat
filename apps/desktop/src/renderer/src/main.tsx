import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { installRemoteBridges } from '@voicechat/ui'
import '@voicechat/ui/styles.css'

// Выбор режима на старте:
//  - URL сервера задан → тонкий клиент: ставим REST+WS-мосты против сервера
//    (claude/STT/TTS и агенты — на сервере), preload-IPC-мосты не используем;
//  - URL нет → локальный режим: мосты уже внедрены preload (Electron IPC).
async function boot(): Promise<void> {
  const serverUrl = (await window.remoteClient?.getUrl()) ?? null
  if (serverUrl) installRemoteBridges(serverUrl)

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
