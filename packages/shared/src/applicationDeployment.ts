import type {
  ApplicationEnvironment,
  ApplicationReleaseManifest,
  ApplicationVersionRequirement
} from './applicationRelease'
export type ApplicationEnvironmentName = 'staging' | 'production'
export interface ApplicationReleaseInput {
  applicationId: string
  version: string
  image: string
  baseBranch: string
  requires: ApplicationVersionRequirement[]
}
export interface ApplicationReleaseRecord {
  id: string
  projectId: string
  input: ApplicationReleaseInput
  branch: string
  status: 'preparing' | 'ready' | 'failed'
  manifest: ApplicationReleaseManifest | null
  createdAt: number
  finishedAt: number | null
  triggeredBy: string
  log: string
}
export interface ApplicationDeploymentRecord {
  id: string
  projectId: string
  environment: ApplicationEnvironmentName
  requestId: string
  /** Отпечаток выбранной машины/checkout/config: рестарт не меняет площадку. */
  targetFingerprint?: string
  status: 'deploying' | 'released' | 'failed' | 'uncertain'
  releases: ApplicationReleaseManifest[]
  previous: ApplicationEnvironment
  result: ApplicationEnvironment | null
  rollbackOf: string | null
  createdAt: number
  finishedAt: number | null
  triggeredBy: string
  log: string
}
export interface ApplicationReleaseOverview {
  environment: ApplicationEnvironment
  activeDeploymentId: string | null
  releases: ApplicationReleaseRecord[]
  deployments: ApplicationDeploymentRecord[]
}
export interface ApplicationDeployInput {
  requestId: string
  expectedRevision: number
  releaseIds: string[]
  rollbackOf?: string
}
