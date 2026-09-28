import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CleanupBusy, CleanupStore, INSTANCE_ID } from './store.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cleanup-store-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const store = () => new CleanupStore(join(dir, 'registry.json'))
const age = (path: string, ms: number) => { const t = (Date.now() - ms) / 1000; utimesSync(path, t, t) }
const beat = (s: CleanupStore, instance: string, at: number) => {
  mkdirSync(s.instancesDir, { recursive: true })
  writeFileSync(join(s.instancesDir, instance + '.json'), JSON.stringify({ pid: 1, host: 'other', at }))
}

it('retires a pre-heartbeat lock left by a replaced container only after it ages out', async () => {
  const s = store()
  writeFileSync(s.path + '.lock', JSON.stringify({ pid: 1, host: 'old-container' }))
  await expect(s.locked(async () => 'x')).rejects.toBeInstanceOf(CleanupBusy)
  age(s.path + '.lock', 11 * 60_000)
  await expect(s.locked(async () => 'recovered')).resolves.toBe('recovered')
  expect(existsSync(s.path + '.lock')).toBe(false)
})

it('keeps a lock whose owner instance still beats and retires one whose beat stopped', async () => {
  const s = store(), live = randomUUID(), dead = randomUUID()
  beat(s, live, Date.now())
  writeFileSync(s.path + '.lock', JSON.stringify({ pid: 1, host: 'other', instance: live }))
  await expect(s.locked(async () => 'x')).rejects.toBeInstanceOf(CleanupBusy)
  beat(s, dead, Date.now() - 5 * 60_000)
  writeFileSync(s.path + '.lock', JSON.stringify({ pid: 1, host: 'other', instance: dead }))
  await expect(s.locked(async () => 'ok')).resolves.toBe('ok')
  writeFileSync(s.path + '.lock', JSON.stringify({ pid: 1, host: 'other', instance: randomUUID() }))
  await expect(s.locked(async () => 'no heartbeat file')).resolves.toBe('no heartbeat file')
})

it('never steals its own in-flight lock but recovers a leftover with its own identity', async () => {
  const s = store()
  let release!: () => void
  const holding = s.locked(() => new Promise<void>(r => { release = r }))
  await new Promise(r => setTimeout(r, 10))
  await expect(s.locked(async () => 'x')).rejects.toBeInstanceOf(CleanupBusy)
  release(); await holding
  writeFileSync(s.path + '.lock', JSON.stringify({ pid: process.pid, host: 'h', instance: INSTANCE_ID }))
  await expect(s.locked(async () => 'own leftover')).resolves.toBe('own leftover')
})

it('removes an abandoned recovery barrier but respects a fresh one', async () => {
  const s = store()
  writeFileSync(s.path + '.lock.recovery', '')
  await expect(s.locked(async () => 'x')).rejects.toBeInstanceOf(CleanupBusy)
  age(s.path + '.lock.recovery', 2 * 60_000)
  await expect(s.locked(async () => 'ok')).resolves.toBe('ok')
})

it('judges consumers by instance heartbeat and keeps legacy consumers conservative', () => {
  const s = store(), dead = randomUUID()
  beat(s, dead, Date.now() - 5 * 60_000)
  expect(s.alive({ pid: 1, host: 'other', instance: INSTANCE_ID })).toBe(true)
  expect(s.alive({ pid: 1, host: 'other', instance: dead })).toBe(false)
  expect(s.alive({ pid: 1, host: 'other' })).toBe(true)
})
