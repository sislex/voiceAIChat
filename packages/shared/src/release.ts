// Подготовленные release-ветки и неизменяемая история production deploy.
export const RELEASE_BRANCH_RE = /^release\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export type ReleaseStatus = 'preparing' | 'checking' | 'ready' | 'queued' | 'switching' | 'building' | 'health_check' | 'failed' | 'released'
export type ReleaseStepKind = 'regression' | 'knowledge_base' | 'switching' | 'building' | 'health_check'
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
  switching: 'Не удалось переключить production checkout',
  building: 'Production-сборка завершилась ошибкой',
  health_check: 'Production не прошёл health-check'
}

export function releaseFailureSummary(kind: string, log: string): string {
  const lines = log.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const explicit = lines.find(line => /^(error|fatal|ошибка|не удалось|production|health-check|база знаний)/i.test(line))
  const fallback = RELEASE_FAILURE_FALLBACK[kind as ReleaseStepKind] ?? lines[0] ?? 'Шаг релиза завершился ошибкой'
  return (explicit ?? fallback).replace(/^error:\s*/i, '').slice(0, 240)
}

export interface ProjectRelease {
  id: string
  projectId: string
  version: string
  branch: string
  /** Неизменяемый SHA, зафиксированный при подготовке release-ветки. */
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

/** Сравнивает только строгие release/x.y.z; null означает невалидную ветку. */
export function compareReleaseBranches(left: string, right: string): number | null {
  const leftVersion = releaseVersion(left)
  const rightVersion = releaseVersion(right)
  if (!leftVersion || !rightVersion) return null
  const leftParts = leftVersion.split('.').map(Number)
  const rightParts = rightVersion.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}
export function assertReleaseBranch(branch: string): string {
  const version = releaseVersion(branch)
  if (!version) throw new Error('Разрешены только ветки release/x.y.z')
  return version
}
export const RELEASE_STEP_ORDER: readonly ReleaseStepKind[] = ['regression', 'knowledge_base', 'switching', 'building', 'health_check']
