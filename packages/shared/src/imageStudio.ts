// Студия картинок — мастерская по образцу Make, но для изображений: слева чат
// с ассистентом, справа галерея файлов разговора. Ассистент рисует картинки
// своим штатным способом (fenced-блок image), сервер складывает их в галерею;
// панель умеет загрузить свои, сгенерировать по промпту, поправить выбранную
// по промпту, переименовать, удалить и скачать.

/** Вид чата студии; предикат — рядом, чтобы не сравнивать строку руками. */
export const IMAGE_STUDIO_KIND = 'images' as const

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
  /** Имя файла в галерее (плоское, без каталогов). */
  path: string
  size: number
  updatedAt: number
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
  maxConversationBytes: 128 * 1024 * 1024
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
