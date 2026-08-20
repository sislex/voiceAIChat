import { homedir } from 'node:os'
import { join } from 'node:path'
export interface AutomationRunnerConfig {
  host: string; port: number; token: string; dataDir: string; concurrency: number; cancelGraceMs: number
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AutomationRunnerConfig {
  return {
    host: env.HOST ?? '0.0.0.0', port: Number(env.PORT ?? 8800),
    token: env.VC_AUTOMATION_RUNNER_TOKEN ?? '',
    dataDir: env.VC_AUTOMATION_DATA_DIR ?? join(homedir(), '.voicechat-automation'),
    concurrency: Math.max(1, Number(env.VC_AUTOMATION_CONCURRENCY ?? 1)),
    cancelGraceMs: Math.max(0, Number(env.VC_AUTOMATION_CANCEL_GRACE_MS ?? 10_000))
  }
}
