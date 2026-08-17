import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { installRemoteBridges } from '@voicechat/ui'
import '@voicechat/ui/styles.css'

// Desktop всегда работает тонким клиентом. URL обязателен: main-процесс
// показывает окно настройки до запуска renderer.
async function boot(): Promise<void> {
  const serverUrl = (await window.remoteClient.getUrl()) ?? null
  if (!serverUrl) return
  const agentState = await window.agentAdmin.getState()
  installRemoteBridges(serverUrl, agentState.status === 'online' ? agentState.id : null)
  window.agentAdmin.onStatus((next) => window.featurePreview?.setLocalAgentId?.(next.status === 'online' ? next.id : null))

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
