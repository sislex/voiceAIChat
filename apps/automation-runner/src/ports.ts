import type { AutomationJob, AutomationTerminalResult } from '@voicechat/shared'
export interface CancellableExecution<T> {
  result: Promise<T>; cancel(): Promise<void>; forceCancel(): Promise<void>
}
export interface MachineExecutionPort {
  available(): Promise<boolean>
  execute(job: AutomationJob, signal: AbortSignal): CancellableExecution<unknown>
}
export interface LlmRunnerPort {
  available(): Promise<boolean>
  execute(job: AutomationJob, signal: AbortSignal): CancellableExecution<unknown>
}
export interface AutomationExecutor {
  execute(job: AutomationJob, signal: AbortSignal): CancellableExecution<AutomationTerminalResult>
}
