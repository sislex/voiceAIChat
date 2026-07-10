import { describe, it, expect } from 'vitest'
import { isModelPresent, modelFileName, modelPath, type StatFs } from './models'

describe('модели Whisper: имена и пути', () => {
  it('сопоставляет модель с GGML-файлом', () => {
    expect(modelFileName('large-v3-turbo')).toBe('ggml-large-v3-turbo.bin')
    expect(modelFileName('medium')).toBe('ggml-medium.bin')
    expect(modelFileName('small')).toBe('ggml-small.bin')
  })

  it('строит абсолютный путь модели', () => {
    expect(modelPath('/models', 'small')).toBe('/models/ggml-small.bin')
  })
})

describe('isModelPresent', () => {
  function fakeFs(files: Record<string, number>): StatFs {
    return {
      existsSync: (p) => p in files,
      statSync: (p) => ({ size: files[p] })
    }
  }

  it('false, если файла нет', () => {
    expect(isModelPresent('/models', 'small', fakeFs({}))).toBe(false)
  })

  it('false для обрезанного/пустого файла', () => {
    const fs = fakeFs({ '/models/ggml-small.bin': 500 })
    expect(isModelPresent('/models', 'small', fs)).toBe(false)
  })

  it('true для полноразмерного файла', () => {
    const fs = fakeFs({ '/models/ggml-small.bin': 500_000_000 })
    expect(isModelPresent('/models', 'small', fs)).toBe(true)
  })
})
