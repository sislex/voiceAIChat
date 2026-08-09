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
