import { STORAGE_ERROR_STATUS, type StorageErrorCode } from '@voicechat/shared/fileStorage'
export class StorageServiceError extends Error {
  readonly statusCode: number
  constructor(readonly code: StorageErrorCode) {
    super(code)
    this.name = 'StorageServiceError'
    this.statusCode = STORAGE_ERROR_STATUS[code]
  }
}
