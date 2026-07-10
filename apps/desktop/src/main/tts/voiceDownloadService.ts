// Сервис скачивания голосов Piper: слушает tts:downloadVoice, качает голос с
// прогрессом и шлёт события в renderer.

import { ipcMain } from 'electron'
import type { IpcEventChannel, IpcEventPayload, IpcSendPayload } from '@shared/ipc'
import { downloadPiperVoice } from './voiceDownload'

export interface VoiceDownloadServiceDeps {
  voicesDir: string
  send: <C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>) => void
}

export interface VoiceDownloadService {
  dispose(): void
}

export function createVoiceDownloadService(deps: VoiceDownloadServiceDeps): VoiceDownloadService {
  const active = new Set<string>()

  const onDownload = async (
    _e: unknown,
    payload: IpcSendPayload<'tts:downloadVoice'>
  ): Promise<void> => {
    const { id } = payload
    if (active.has(id)) return
    active.add(id)
    try {
      await downloadPiperVoice(id, deps.voicesDir, (percent) =>
        deps.send('tts:voiceProgress', { id, percent })
      )
      deps.send('tts:voiceDone', { id })
    } catch (err) {
      deps.send('tts:voiceError', {
        id,
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      active.delete(id)
    }
  }

  ipcMain.on('tts:downloadVoice', onDownload)

  return {
    dispose(): void {
      ipcMain.removeListener('tts:downloadVoice', onDownload)
    }
  }
}
