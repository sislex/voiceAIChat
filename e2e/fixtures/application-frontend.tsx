import React from 'react'
import { createRoot } from 'react-dom/client'
import { UiProviders } from '@voicechat/ui-kit'
import {
  configureApplicationHost,
  createApplicationPanel
} from '../../packages/ui/src/runtime/applicationHost'
import type { ImageStudioPaneProps } from '@voicechat/image-studio-app/panelContract'
import type { WebReaderFrameProps } from '@voicechat/web-reader-app/panelContract'
import type { MakePaneProps } from '@voicechat/make-app/panelContract'
import type { BrowserSessionPaneProps } from '@voicechat/playwright-reader-app/panelContract'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import '@voicechat/ui/styles.css'
import '../../packages/ui/src/styles/app.css'
configureApplicationHost(
  new URLSearchParams(location.search).get('apiBase') ?? ''
)
const Make = createApplicationPanel<MakePaneProps>('make-ui')
const Reader = createApplicationPanel<BrowserSessionPaneProps>(
  'playwright-reader-ui'
)
const Studio = createApplicationPanel<ImageStudioPaneProps>('image-studio-ui')
const WebReader = createApplicationPanel<WebReaderFrameProps>('web-reader-ui')
const mode = new URLSearchParams(location.search).get('panel')
const api = createFakeApi()
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiProviders>
      <div style={{ height: '100vh', display: 'flex' }}>
        <textarea aria-label="Сообщение" defaultValue="Черновик чата" />
        {mode === 'make' ? (
          <Make conversationId="e2e-make" api={api} previewBase="/preview/" />
        ) : mode === 'image' ? (
          <Studio conversationId="e2e-image" api={api} />
        ) : mode === 'web-reader' ? (
          <WebReader
            conversationId="e2e-web-reader"
            conversationUrl={null}
            projectUrl={null}
            onSave={async () => {}}
            platform={{
              origin: location.origin,
              subscribeMessages: (listener) => {
                window.addEventListener('message', listener)
                return () => window.removeEventListener('message', listener)
              }
            }}
          />
        ) : (
          <Reader conversationId="e2e-reader" />
        )}
      </div>
    </UiProviders>
  </React.StrictMode>
)
