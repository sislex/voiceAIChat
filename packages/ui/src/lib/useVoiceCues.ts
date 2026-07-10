// Проигрывает звуковые сигналы на переходах голосового состояния:
// → listening (старт записи), listening → transcribing (стоп записи),
// → thinking (модель думает). На монтировании сигнал не играет.

import { useEffect, useRef } from 'react'
import type { VoiceState } from '@shared/types'
import { playStartCue, playStopCue, playThinkingCue } from './cues'

export function useVoiceCues(voice: VoiceState): void {
  const prev = useRef<VoiceState>(voice)

  useEffect(() => {
    const from = prev.current
    if (from === voice) return
    prev.current = voice

    if (voice === 'listening') {
      playStartCue()
    } else if (voice === 'transcribing' && from === 'listening') {
      playStopCue()
    } else if (voice === 'thinking') {
      playThinkingCue()
    }
  }, [voice])
}
