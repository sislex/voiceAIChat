import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@voicechat/ui'
import '@voicechat/ui/styles.css'

// UI общий с веб-версией (@voicechat/ui). Мосты window.* внедряет preload (Electron IPC).
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
