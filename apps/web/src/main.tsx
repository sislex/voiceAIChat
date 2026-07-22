import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { installRemoteBridges } from '@voicechat/ui'
import '@voicechat/ui/styles.css'
import { SERVER_HTTP } from './bridges/config'

// Подключаем мосты (REST+WS) до монтирования — стор читает window.* при инициализации.
// SERVER_HTTP: '' (same-origin) или VITE_SERVER_URL.
installRemoteBridges(SERVER_HTTP)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
