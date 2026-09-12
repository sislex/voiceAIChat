// Подготовленные release-ветки и неизменяемая история production deploy.
export const RELEASE_BRANCH_RE = /^release\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export type ReleaseStatus = 'preparing' | 'checking' | 'ready' | 'queued' | 'switching' | 'building' | 'health_check' | 'failed' | 'released'
export type ReleaseStepKind = 'checkout' | 'regression' | 'knowledge_base' | 'switching' | 'building' | 'health_check'
export type ReleaseStepStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped'

export interface ReleaseTimeouts {
  checkoutMs: number
  knowledgeBaseMs: number
  regressionMs: number
  switchingMs: number
  buildingMs: number
  healthCheckMs: number
}
export const DEFAULT_RELEASE_TIMEOUTS: ReleaseTimeouts = { checkoutMs: 300_000, knowledgeBaseMs: 600_000, regressionMs: 600_000, switchingMs: 120_000, buildingMs: 600_000, healthCheckMs: 1_800_000 }
export const RELEASE_TIMEOUT_MIN_MS = 1_000
export const RELEASE_TIMEOUT_MAX_MS = 86_400_000
export function validateReleaseTimeouts(value: ReleaseTimeouts): ReleaseTimeouts {
  for (const [name, timeout] of Object.entries(value)) if (!Number.isInteger(timeout) || timeout < RELEASE_TIMEOUT_MIN_MS || timeout > RELEASE_TIMEOUT_MAX_MS) throw new Error(`${name}: лимит должен быть от 1 секунды до 24 часов`)
  return value
}
export const releaseStepLimit = (kind: ReleaseStepKind, limits: ReleaseTimeouts): number => ({checkout:limits.checkoutMs,knowledge_base:limits.knowledgeBaseMs,regression:limits.regressionMs,switching:limits.switchingMs,building:limits.buildingMs,health_check:limits.healthCheckMs})[kind]

export interface ReleaseBranch { branch: string; version: string; sha: string }

/** Разрешённая текущему пользователю машина для подготовки release-ветки. */
export interface ReleaseMachine {
  agentId: string
  name: string
  ownership: 'mine' | 'project'
  access: 'owner' | 'full' | 'read'
  online: boolean
  path: string
  reposRoot: string
  eligible: boolean
  unavailableReason: string | null
}

export interface ReleaseMachineCatalog {
  machines: ReleaseMachine[]
  lastAgentId: string | null
}

export interface ManagedPreflightResult {
  ok: boolean
  environment: 'production' | 'staging'
  paths: import('./projects').ManagedEnvironmentPaths
  checks: Record<'marker' | 'manifest' | 'origin' | 'branch' | 'write' | 'freeSpace' | 'deployCommand' | 'healthCheckCommand', { ok: boolean; message: string }>
}
export type ManagedPreflightConfirmation = ManagedPreflightResult & { confirmationToken: string }

/** Итог авто-подготовки прод-машины (bootstrap): что сделано и что осталось руками. */
export interface ProductionBootstrapResult {
  /** Managed-режим включён (preflight пройден). */
  ok: boolean
  /** Итоговый режим production после bootstrap. */
  mode: 'managed' | 'legacy'
  /** Машина назначена и default (для CI/merge/тасков), т.к. валидной default не было. */
  defaultMachineSet: boolean
  /** Результат managed preflight (чек-лист). */
  preflight: ManagedPreflightResult
  /** Человекочитаемая подсказка про оставшийся ручной шаг (CLI login). */
  cliLoginHint: string
}
export interface ReleaseStep {
  id: string
  kind: ReleaseStepKind
  status: ReleaseStepStatus
  model: string | null
  attempt: number
  log: string
  startedAt: number | null
  finishedAt: number | null
  /** Неизменяемый снимок лимита шага; null только у legacy-записей. */
  limitMs?: number | null
}
const RELEASE_FAILURE_FALLBACK: Record<ReleaseStepKind, string> = {
  checkout: 'Не удалось подготовить checkout',
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

/** Облегчённая строка списка: без шагов, логов и служебных снимков рана. */
export interface ProjectReleaseSummary {
  id: string
  branch: string
  sha: string
  status: ReleaseStatus
  previousReleaseId: string | null
  createdAt: number
  durationMs: number | null
  /** Deploy attempt number of the branch; preparations are attempt 1. */
  attempt?: number
  /** Short cause of a failed step, so the list explains a red row without opening it. */
  failure?: string | null
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
  /** Снимок машины и checkout на момент создания рана. */
  agentId?: string | null
  checkoutPath?: string | null
  deletedAt?: number | null
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
/**
 * Next patch version after the highest existing `release/x.y.z` branch. The
 * Release Center offers it as a one-click default: typing the version by hand
 * was the most frequent source of "branch already exists" errors.
 */
export function suggestNextReleaseVersion(branches: readonly string[], fallback = '0.1.0'): string {
  let best: string | null = null
  for (const branch of branches) {
    if (!releaseVersion(branch)) continue
    if (best === null || (compareReleaseBranches(branch, best) ?? 0) > 0) best = branch
  }
  if (best === null) return fallback
  const [major, minor, patch] = releaseVersion(best)!.split('.').map(Number) as [number, number, number]
  return `${major}.${minor}.${patch + 1}`
}
/** What the Release Center needs to know about production before offering «Задеплоить». */
export interface ProductionReadiness {
  ready: boolean
  mode: 'legacy' | 'managed'
  /** Human-readable names of the missing settings, in the order of the settings form. */
  missing: string[]
}
/**
 * Mirrors `releaseProductionTarget` on the server: the deploy button used to
 * answer with a 400 after the click, now the tab explains what to configure.
 */
export function productionReadiness(detail: {
  productionAgentId?: string | null
  productionEnvironmentMode?: 'legacy' | 'managed'
  productionDeployCommand?: string
  productionHealthCheckCommand?: string
  productionCheckoutPath?: string
  gitUrl?: string | null
  machines?: ReadonlyArray<{ agentId: string }>
}): ProductionReadiness {
  const mode = detail.productionEnvironmentMode === 'managed' ? 'managed' : 'legacy'
  const missing: string[] = []
  if (!detail.gitUrl) missing.push('gitUrl проекта')
  if (!detail.productionAgentId) missing.push('production-машина')
  else if (detail.machines && !detail.machines.some((machine) => machine.agentId === detail.productionAgentId)) missing.push('production-машина не привязана к проекту')
  if (mode === 'legacy' && !detail.productionCheckoutPath?.trim()) missing.push('production checkout')
  if (!detail.productionDeployCommand?.trim()) missing.push('команда деплоя')
  if (!detail.productionHealthCheckCommand?.trim()) missing.push('команда health-check')
  return { ready: missing.length === 0, mode, missing }
}
/** «release/1.2.3», «v1.2.3» and spaces pasted into the version field become «1.2.3». */
export function normalizeReleaseVersionInput(value: string): string {
  return value.trim().replace(/^release\//i, '').replace(/^v/i, '').trim()
}
export function assertReleaseBranch(branch: string): string {
  const version = releaseVersion(branch)
  if (!version) throw new Error('Разрешены только ветки release/x.y.z')
  return version
}
export const RELEASE_STEP_ORDER: readonly ReleaseStepKind[] = ['checkout', 'regression', 'knowledge_base', 'switching', 'building', 'health_check']
