import { setPlaybackObserver } from '@sislexa/voice/browser/lib/ttsPlayer'
import { uiPerformance } from './uiPerformance'
setPlaybackObserver(() => uiPerformance().mark('message', 'message_first_audio'))
export * from '@sislexa/voice/browser/lib/ttsPlayer'
