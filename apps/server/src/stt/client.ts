import type { SttRunnerEvent, SttRunnerHealth, WhisperModel, WhisperModelInfo } from '@voicechat/shared'
export interface SttRun {
  write(pcm: Int16Array): void
  end(): void
  cancel(): void
}
export interface SttClient {
  health(): Promise<SttRunnerHealth>
  models(): Promise<WhisperModelInfo[]>
  deleteModel(model: WhisperModel): Promise<void>
  downloadModel(model: WhisperModel, onProgress: (percent: number) => void): Promise<void>
  start(input: { runId: string; model: WhisperModel; language: string; diarization: boolean }, onEvent: (event: SttRunnerEvent) => void): SttRun
}
