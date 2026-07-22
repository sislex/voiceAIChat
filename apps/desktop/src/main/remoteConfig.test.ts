import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readServerUrl, writeServerUrl } from './remoteConfig'

describe('remoteConfig', () => {
  it('нет файла → null (локальный режим)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-'))
    try {
      expect(readServerUrl(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('write → read, обрезает хвостовой слэш', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-'))
    try {
      writeServerUrl(dir, 'http://host:8787/')
      expect(readServerUrl(dir)).toBe('http://host:8787')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('null/пусто → сброс в локальный режим', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-'))
    try {
      writeServerUrl(dir, 'http://host:8787')
      writeServerUrl(dir, null)
      expect(readServerUrl(dir)).toBeNull()
      writeServerUrl(dir, '   ')
      expect(readServerUrl(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
