import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@voicechat/ui'
import '@voicechat/ui/styles.css'
import { installBridges } from './bridges'

// Подключаем мосты (REST+WS) до монтирования — стор читает window.* при инициализации.
installBridges()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
