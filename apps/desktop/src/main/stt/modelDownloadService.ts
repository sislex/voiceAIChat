// Сервис скачивания модели Whisper (Шаг 9). Слушает stt:download, качает текущую
// модель с прогрессом и шлёт события в renderer.

import { ipcMain } from 'electron'
import type { IpcEventChannel, IpcEventPayload } from '@shared/ipc'
import type { WhisperModel } from '@shared/types'
import { downloadModel } from './download'

export interface ModelDownloadServiceDeps {
  modelsDir: string
  getModel: () => WhisperModel
  send: <C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>) => void
}

export interface ModelDownloadService {
  dispose(): void
}

export function createModelDownloadService(deps: ModelDownloadServiceDeps): ModelDownloadService {
  let downloading = false

  const onDownload = async (): Promise<void> => {
    if (downloading) return
    downloading = true
    try {
      await downloadModel(deps.getModel(), deps.modelsDir, (percent) =>
        deps.send('stt:downloadProgress', { percent })
      )
      deps.send('stt:downloadDone', undefined as never)
    } catch (err) {
      deps.send('stt:downloadError', {
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      downloading = false
    }
  }

  ipcMain.on('stt:download', onDownload)

  return {
    dispose(): void {
      ipcMain.removeListener('stt:download', onDownload)
    }
  }
}
