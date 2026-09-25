import { afterAll, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { loadConfig } from '../config.js'
import { privateDataDir } from './privateDataDir.js'

const allocated: string[] = []
it('supplies separate private roots for partial integration configs without mutating their env', () => {
  const env = { PORT: '0' }
  const first = loadConfig(env)
  const second = loadConfig(env)
  allocated.push(first.dataDir, second.dataDir)
  expect(first.dataDir).not.toBe(second.dataDir)
  expect(existsSync(first.dataDir)).toBe(true)
  expect(existsSync(second.dataDir)).toBe(true)
  expect(env).toEqual({ PORT: '0' })
})

it('retains explicit fixture paths', () => {
  const explicit = privateDataDir('core-explicit-')
  try {
    expect(loadConfig({ VC_DATA_DIR: explicit.path }).dataDir).toBe(explicit.path)
  } finally { explicit.remove() }
})

afterAll(() => {
  for (const path of allocated) expect(existsSync(path)).toBe(false)
})
