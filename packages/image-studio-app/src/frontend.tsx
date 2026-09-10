import { ImageStudioPane } from './components/ImageStudioPane'
import './panel.css'
declare const __APPLICATION_VERSION__: string
declare const __APPLICATION_COMMIT__: string | null
// Регистрация проходит только через API оболочки; React и UI-контексты её же.
;(window as unknown as { VoiceChatApplicationHost: { register(id: string, version: string, commit: string | null, component: unknown): void } }).VoiceChatApplicationHost.register('image-studio-ui', __APPLICATION_VERSION__, __APPLICATION_COMMIT__, ImageStudioPane)
