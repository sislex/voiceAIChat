// Image Studio follows the Make workshop layout: assistant chat on the left
// and the conversation gallery on the right. Assistant image blocks are added
// to that gallery alongside uploads and prompt-driven edits. The panel keeps
// version history and supports edits scoped to selected objects.

import type { ImageRetouchSelection } from './imageRetouch'

/** Вид чата студии; предикат — рядом, чтобы не сравнивать строку руками. */
export const IMAGE_STUDIO_KIND = 'images' as const

export const IMAGE_STUDIO_TOOLS = [
  'image_list',
  'image_open',
  'image_find_objects',
  'image_generate',
  'image_edit',
  'image_retouch',
  'image_extract',
  'image_place',
  'image_restore',
  'image_rename',
  'image_delete'
] as const

export const IMAGE_STUDIO_ASSISTANT_HINT =
  'Инструмент «Студия картинок»: справа открыта галерея пользователя. Работай с ней инструментами image_*: сначала image_list, затем image_open для визуального чтения нужного файла. ' +
  'Любая генерация, полная правка, ретушь, вставка объекта или откат создаёт новую версию и сохраняет исходник. Для лица, кожи, волос, одежды и отдельных предметов сначала используй image_find_objects или image_open, затем image_retouch с прямоугольником, лассо или волшебной палочкой: пиксели вне выделения будут сохранены. ' +
  'Чтобы править предмет отдельно, вызови image_extract, при необходимости image_edit для полученного прозрачного PNG, затем image_place. Для отката используй image_restore. ' +
  'После каждой операции снова вызови image_list и коротко назови пользователю созданный файл. Отвечай на языке пользователя.'

export function isImageStudioConversation(value: { assistantKind?: string | null }): boolean {
  return value.assistantKind === IMAGE_STUDIO_KIND
}

export interface ImageStudioFile {
  /** Промпт, которым нарисован/поправлен файл (нет у загруженных руками). */
  prompt?: string
  /** Имя исходника, если файл — результат правки другой картинки. */
  source?: string
  /** Сколько миллисекунд занял ран генерации/правки. */
  tookMs?: number
  /** How this version was created; old sidecars without it remain compatible. */
  operation?: ImageStudioOperation
  /** Historical version whose pixels were restored into this node. */
  restoredFrom?: string
  /** Bounds of an extracted object in its source image. */
  selection?: ImageStudioSelectionBounds
  /** Имя файла в галерее (плоское, без каталогов). */
  path: string
  size: number
  updatedAt: number
}

export type ImageStudioOperation =
  | 'upload'
  | 'generate'
  | 'edit'
  | 'retouch'
  | 'extract'
  | 'place'
  | 'restore'
  | 'transform'

export interface ImageStudioSelectionBounds {
  kind: 'rectangle' | 'lasso' | 'mask'
  x: number
  y: number
  width: number
  height: number
}

/**
 * A browser magic wand sends a compact PNG mask. Rectangle and lasso remain
 * coordinate based so an assistant can create them without binary payloads.
 */
export type ImageStudioSelection = ImageRetouchSelection | {
  kind: 'mask'
  width: number
  height: number
  dataBase64: string
}

/** Разрешённые расширения: студия хранит только изображения. */
export const IMAGE_STUDIO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] as const

export function isImageStudioPath(path: string): boolean {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  return (IMAGE_STUDIO_EXTENSIONS as readonly string[]).includes(ext)
}

export const IMAGE_STUDIO_LIMITS = {
  /** Длиннее — это уже ТЗ, а не промпт; модель теряет фокус, ран дорожает. */
  maxPromptChars: 4000,
  /** Файл больше — это уже не картинка для макета, а исходник видео. */
  maxFileBytes: 12 * 1024 * 1024,
  /** Квота галереи одного разговора. */
  maxConversationBytes: 128 * 1024 * 1024,
  /** A monochrome PNG mask must stay cheap to validate and transport. */
  maxMaskBytes: 4 * 1024 * 1024
} as const

/** MIME по расширению — для отдачи файла браузеру. */
export function imageStudioMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}
