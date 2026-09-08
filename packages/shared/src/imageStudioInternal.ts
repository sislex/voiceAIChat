// Внутренний контракт студия ↔ ядро. Файлы передаются явно: отдельному сервису
// не нужен доступ к профилям CLI или базе разговоров на диске ядра.
import { IMAGE_STUDIO_LIMITS } from './imageStudio'

export const INTERNAL_IMAGE_STUDIO_CORE_PATH = '/internal/image-studio/core'
export const INTERNAL_IMAGE_STUDIO_SERVICE_PATH = '/internal/image-studio/service'
export const INTERNAL_IMAGE_STUDIO_GENERATE_PATH = '/internal/image-studio/generate'
export const IMAGE_STUDIO_HEALTH_PATH = '/v1/health'
export const IMAGE_STUDIO_PROXY_PREFIXES = ['/api/image-studio', '/g'] as const
export const IMAGE_STUDIO_CORE_METHODS = ['conversation', 'renameConversation', 'readGenerated'] as const
export const IMAGE_STUDIO_SERVICE_METHODS = ['promptContext', 'captureImages'] as const
/** Генерация дольше обычного RPC; одинаковый предел у прокси и канала к исполнителю. */
export const IMAGE_STUDIO_GENERATION_TIMEOUT_MS = 10 * 60_000
export const IMAGE_STUDIO_API_BODY_LIMIT = 20 * 1024 * 1024
/** Четыре референса по 12 МБ в base64 + запас на JSON. */
export const IMAGE_STUDIO_RPC_BODY_LIMIT = 4 * Math.ceil(IMAGE_STUDIO_LIMITS.maxFileBytes / 3) * 4 + 1024 * 1024

export interface ImageStudioWireFile { name: string; dataBase64: string }
export interface ImageStudioGenerateRequest {
  userId: string
  prompt: string
  source?: ImageStudioWireFile
  references?: ImageStudioWireFile[]
}

export function isImageStudioGenerateRequest(value: unknown): value is ImageStudioGenerateRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as ImageStudioGenerateRequest
  const file = (f: ImageStudioWireFile): boolean => Boolean(f && typeof f.name === 'string' && f.name.length <= 1024
    && typeof f.dataBase64 === 'string' && f.dataBase64.length <= Math.ceil(IMAGE_STUDIO_LIMITS.maxFileBytes / 3) * 4)
  return typeof v.userId === 'string' && v.userId.length > 0
    && typeof v.prompt === 'string' && v.prompt.trim().length > 0 && v.prompt.length <= IMAGE_STUDIO_LIMITS.maxPromptChars
    && (v.source === undefined || file(v.source))
    && (v.references === undefined || (Array.isArray(v.references) && v.references.length <= 4 && v.references.every(file)))
    && !(v.source && v.references?.length)
}
