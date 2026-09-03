// Фикстуры студии картинок: одни данные у dom-тестов и сториз (мосты каждый
// собирает сам — тестам нужны vi.fn, витрине нельзя тянуть vitest).
import type { ImageStudioFile } from '@shared/imageStudio'
import { T0 } from './chat'

/** Небольшая галерея: правка с происхождением, «свежая» и загруженная руками. */
export const STUDIO_FILES: ImageStudioFile[] = [
  { path: 'кот-2.png', size: 18432, updatedAt: T0 + 3000, prompt: 'добавь коту шляпу', source: 'кот.png' },
  { path: 'кот.png', size: 15210, updatedAt: T0 + 2000, prompt: 'рыжий кот, акварель' },
  { path: 'логотип.svg', size: 2048, updatedAt: T0 + 1000 }
]

/** Прозрачный PNG 1×1 — превью для сториз и тестов, где важен факт картинки. */
export const STUDIO_PIXEL_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
