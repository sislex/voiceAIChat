// Версионные release-ветки и неизменяемая история публикации.
export const RELEASE_BRANCH_RE = /^release\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export type ReleaseStatus = 'draft' | 'running' | 'failed' | 'released'
export type ReleaseStepKind = 'regression' | 'knowledge_base' | 'merge_main' | 'push_main' | 'production_deploy' | 'health_check' | 'cleanup'
export type ReleaseStepStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped'

export interface ReleaseBranch { branch: string; version: string; sha: string }
export interface ReleaseStep {
  id: string
  kind: ReleaseStepKind
  status: ReleaseStepStatus
  model: string | null
  attempt: number
  log: string
  startedAt: number | null
  finishedAt: number | null
}
const RELEASE_FAILURE_FALLBACK: Record<ReleaseStepKind, string> = {
  regression: 'Регрессионные проверки не прошли',
  knowledge_base: 'База знаний не синхронизирована с кодом',
  merge_main: 'Не удалось объединить релиз с основной веткой',
  push_main: 'Не удалось отправить основную ветку и тег релиза',
  production_deploy: 'Production deploy не был принят',
  health_check: 'Production не прошёл health-check',
  cleanup: 'Не удалось очистить preview или workspace'
}

export function releaseFailureSummary(kind: ReleaseStepKind, log: string): string {
  const lines = log.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (kind === 'knowledge_base' && log.includes('docs/kb/README.md')) {
    return 'Индекс базы знаний устарел; release-preflight должен обновить его до запуска'
  }
  const explicit = lines.find(line =>
    /^(error|fatal|ошибка|не удалось|production|health-check|база знаний)/i.test(line)
    && !/^error: Your local changes/i.test(line)
  )
  return (explicit ?? RELEASE_FAILURE_FALLBACK[kind]).replace(/^error:\s*/i, '').slice(0, 240)
}

export interface ProjectRelease {
  id: string
  projectId: string
  version: string
  branch: string
  /** SHA origin/release/x.y.z, зафиксированный перед первым обязательным шагом. */
  sha: string
  status: ReleaseStatus
  triggeredBy: string
  attempt: number
  previousReleaseId: string | null
  createdAt: number
  releasedAt: number | null
  steps: ReleaseStep[]
}
export function releaseVersion(branch: string): string | null {
  return RELEASE_BRANCH_RE.test(branch) ? branch.slice('release/'.length) : null
}
export function assertReleaseBranch(branch: string): string {
  const version = releaseVersion(branch)
  if (!version) throw new Error('Разрешены только ветки release/x.y.z')
  return version
}
export const RELEASE_STEP_ORDER: readonly ReleaseStepKind[] = [
  'regression', 'knowledge_base', 'merge_main', 'push_main',
  'production_deploy', 'health_check', 'cleanup'
]
