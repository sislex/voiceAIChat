import { STORAGE_ERROR_STATUS, type StorageErrorCode } from '@voicechat/shared/fileStorage'
export class StorageServiceError extends Error {
  readonly statusCode: number
  /** `details` are extra response fields, for example `usedBytes` and `limitBytes` of a quota refusal. */
  constructor(readonly code: StorageErrorCode, message: string = code, readonly details?: Record<string, number>) {
    super(message)
    this.name = 'StorageServiceError'
    this.statusCode = STORAGE_ERROR_STATUS[code]
  }
}
