import { MakeSharedView } from './components/MakeSharedView'
import '@voicechat/ui-foundation/styles.css'
import { MakePane } from './components/MakePane'
import './panel.css'
declare const __APPLICATION_VERSION__: string
declare const __APPLICATION_COMMIT__: string | null
// Регистрация проходит только через API оболочки; React и UI-контексты её же.
;(window as unknown as { VoiceChatApplicationHost: { register(id: string, version: string, commit: string | null, component: unknown): void } }).VoiceChatApplicationHost.register('make-ui', __APPLICATION_VERSION__, __APPLICATION_COMMIT__, { default: MakePane, shared: MakeSharedView })
