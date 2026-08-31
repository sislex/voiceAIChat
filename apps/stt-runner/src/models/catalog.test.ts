// Каталог моделей Whisper. Модуль сам объявляет, что «юнит-тестируемая на моке
// ФС» — здесь этот мок и есть. Главное, что проверяется: обрезанная загрузка не
// считается наличием модели (иначе whisper упадёт на битом файле), и сбой
// statSync не роняет список.

import { describe, expect, it } from 'vitest'
import { WHISPER_MODELS } from '@voicechat/shared'
import { isModelPresent, listModels, modelFileName, modelPath, type StatFs } from './catalog'

const MB = 1_000_000

function fakeFs(sizes: Record<string, number | 'throws'>): StatFs {
  return {
    existsSync: (path) => path in sizes,
    statSync: (path) => {
      const size = sizes[path]
      if (size === 'throws') throw new Error('EIO')
      return { size: size ?? 0 }
    }
  }
}

describe('modelFileName и modelPath', () => {
  it('имена совпадают с ggml-файлами nodejs-whisper', () => {
    expect(modelFileName('large-v3-turbo')).toBe('ggml-large-v3-turbo.bin')
    expect(modelFileName('medium')).toBe('ggml-medium.bin')
    expect(modelFileName('small')).toBe('ggml-small.bin')
  })

  it('у каждой поддерживаемой модели есть имя файла', () => {
    for (const model of WHISPER_MODELS) {
      expect(modelFileName(model)).toMatch(/^ggml-.+\.bin$/)
    }
  })

  it('путь собирается внутри каталога моделей', () => {
    expect(modelPath('/models', 'small')).toBe('/models/ggml-small.bin')
  })
})

describe('isModelPresent', () => {
  it('нет файла — нет модели', () => {
    expect(isModelPresent('/models', 'small', fakeFs({}))).toBe(false)
  })

  it('обрезанная загрузка не считается наличием', () => {
    // Реальные модели ≥ 400 МБ; порог отсекает файл, оставшийся от сбоя скачивания.
    expect(isModelPresent('/models', 'small', fakeFs({ '/models/ggml-small.bin': 0 }))).toBe(false)
    expect(isModelPresent('/models', 'small', fakeFs({ '/models/ggml-small.bin': MB - 1 }))).toBe(false)
  })

  it('файл от порога и больше — модель на месте', () => {
    expect(isModelPresent('/models', 'small', fakeFs({ '/models/ggml-small.bin': MB }))).toBe(true)
    expect(isModelPresent('/models', 'small', fakeFs({ '/models/ggml-small.bin': 500 * MB }))).toBe(true)
  })

  it('сбой statSync трактуется как отсутствие, а не как исключение', () => {
    expect(() => isModelPresent('/models', 'small', fakeFs({ '/models/ggml-small.bin': 'throws' }))).not.toThrow()
    expect(isModelPresent('/models', 'small', fakeFs({ '/models/ggml-small.bin': 'throws' }))).toBe(false)
  })
})

describe('listModels', () => {
  it('перечисляет все поддерживаемые модели, а не только скачанные', () => {
    const list = listModels('/models', fakeFs({ '/models/ggml-small.bin': 500 * MB }))
    expect(list.map((item) => item.model)).toEqual(WHISPER_MODELS)
    expect(list.find((item) => item.model === 'small')).toEqual({ model: 'small', present: true, sizeBytes: 500 * MB })
  })

  it('у отсутствующей модели размер нулевой, а не унаследованный', () => {
    const list = listModels('/models', fakeFs({}))
    expect(list.every((item) => item.present === false && item.sizeBytes === 0)).toBe(true)
  })

  it('сбой statSync у присутствующего файла даёт размер 0 и не роняет список', () => {
    // existsSync говорит «есть», statSync бросает: список обязан собраться.
    const fs: StatFs = {
      existsSync: () => true,
      statSync: (path) => { if (path.includes('medium')) throw new Error('EIO'); return { size: 500 * MB } }
    }
    const list = listModels('/models', fs)
    expect(list.find((item) => item.model === 'medium')).toEqual({ model: 'medium', present: false, sizeBytes: 0 })
    expect(list.find((item) => item.model === 'small')?.present).toBe(true)
  })
})
