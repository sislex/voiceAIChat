import { setPlaybackObserver } from '@voicechat/voice-browser/lib/ttsPlayer'
import { uiPerformance } from './uiPerformance'
setPlaybackObserver(() => uiPerformance().mark('message', 'message_first_audio'))
export * from '@voicechat/voice-browser/lib/ttsPlayer'
