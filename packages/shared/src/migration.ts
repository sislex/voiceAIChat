import { managedChatAttachmentsPath, recommendedChatStoragePath, validateStorageRelativePath } from './projects'

export const STORAGE_MIGRATION_SCHEMA_VERSION = 1 as const
export const STORAGE_MIGRATION_CHECKSUM_ALGORITHM = 'sha256' as const

export const LEGACY_STORAGE_DIRECTORY_KINDS = ['uploads', 'generated', 'reposRoot', 'preview', 'checkout'] as const
export type LegacyStorageDirectoryKind = typeof LEGACY_STORAGE_DIRECTORY_KINDS[number]

export function migrationPathKey(path: string, platform: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '')
  const parts = normalized.split('/')
  const unc = platform === 'win32' && normalized.startsWith('//')
  if (!normalized || parts.some((part, index) => (part === '.' || part === '..') || (part === '' && index > (unc ? 1 : 0)))) throw new Error('Migration path must be normalized')
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function isMigrationPathInside(path: string, root: string, platform: string): boolean {
  const candidate = migrationPathKey(path, platform)
  const parent = migrationPathKey(root, platform)
  return candidate.startsWith(parent + '/')
}

export type MigrationAssignment =
  | { kind: 'chat'; conversationId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string }
  | { kind: 'environment'; projectId: string; environment: 'production' | 'staging' | 'test' | 'preview'; taskId?: string; previewId?: string }
  | { kind: 'undefined'; reason: string }

export type MigrationConflict =
  | { kind: 'destination-exists'; destinationSize: number; destinationChecksum?: string }
  | { kind: 'case-collision'; path: string }
  | { kind: 'overlapping-destination'; itemId: string }
  | { kind: 'unsafe-path'; message: string }

export type MigrationItemStatus = 'planned' | 'undefined' | 'conflict' | 'copying' | 'copied' | 'verified' | 'source-changed' | 'failed' | 'deleted'
export interface VerificationResult { algorithm: typeof STORAGE_MIGRATION_CHECKSUM_ALGORITHM; sourceSize: number; destinationSize: number; sourceChecksum: string; destinationChecksum: string; verified: boolean; verifiedAt: number }
export interface MigrationItem { id: string; source: string; destination: string | null; assignment: MigrationAssignment; size: number; mtime: number; checksum: string; conflict: MigrationConflict | null; status: MigrationItemStatus; verification?: VerificationResult; error?: string }
export type MigrationStatus = 'dry-run-ready' | 'copying' | 'copy-interrupted' | 'copy-complete' | 'deleting' | 'complete'
export interface MigrationPlan { schemaVersion: typeof STORAGE_MIGRATION_SCHEMA_VERSION; id: string; userId: string; machineId: string; storageId: string; platform: string; status: MigrationStatus; createdAt: number; copyConfirmedAt?: number; deleteConfirmedAt?: number; totalBytes: number; items: MigrationItem[] }
export type MigrationAuditAction = 'dry-run' | 'copy-confirmed' | 'copy-started' | 'copy-verified' | 'copy-skipped' | 'copy-failed' | 'resumed' | 'link-mapped' | 'delete-confirmed' | 'source-deleted' | 'delete-skipped'
export interface MigrationAuditEvent { id: string; planId: string; itemId?: string; actor: string; action: MigrationAuditAction; outcome: 'success' | 'blocked' | 'failed'; at: number; detail?: string }
export interface MigrationPathMapping { userId: string; machineId: string; legacyPath: string; managedPath: string; planId: string; itemId: string; createdAt: number }

export function migrationDestinationRelativePath(assignment: Exclude<MigrationAssignment, { kind: 'undefined' }>, fileName: string): string {
  const safeFile = validateStorageRelativePath(fileName)
  if (safeFile.includes('/')) throw new Error('Migration fileName must be a single segment')
  if (assignment.kind === 'chat') return managedChatAttachmentsPath(recommendedChatStoragePath({ kind: 'chat', conversationId: assignment.conversationId })) + '/' + safeFile
  if (assignment.kind === 'project') return `projects/${validateStorageRelativePath(assignment.projectId)}/artifacts/${safeFile}`
  if (assignment.kind === 'task') return `projects/${validateStorageRelativePath(assignment.projectId)}/tasks/${validateStorageRelativePath(assignment.taskId)}/artifacts/${safeFile}`
  const project = validateStorageRelativePath(assignment.projectId)
  if (assignment.environment === 'production' || assignment.environment === 'staging') return `projects/${project}/environments/${assignment.environment}/artifacts/${safeFile}`
  if (!assignment.taskId) throw new Error('taskId required for test/preview environment')
  const task = validateStorageRelativePath(assignment.taskId)
  if (assignment.environment === 'test') return `projects/${project}/tasks/${task}/environments/test/artifacts/${safeFile}`
  if (!assignment.previewId) throw new Error('previewId required')
  return `projects/${project}/tasks/${task}/environments/preview/${validateStorageRelativePath(assignment.previewId)}/artifacts/${safeFile}`
}
