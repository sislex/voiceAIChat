import { lstat, readdir, rm } from 'node:fs/promises'
import { isAbsolute, parse, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DAY_MS = 86_400_000

function integer(value, fallback, name) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`)
  return parsed
}

export function retentionPlan(entries, options = {}) {
  const now = options.now ?? Date.now()
  const latest = integer(options.latest, 5, 'latest')
  const daily = integer(options.daily, 14, 'daily')
  const weekly = integer(options.weekly, 8, 'weekly')
  const monthly = integer(options.monthly, 12, 'monthly')
  if (latest < 2) throw new Error('latest must retain at least two recovery points')
  const sorted = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
  const keep = new Set(sorted.slice(0, latest).map(entry => entry.name))
  const buckets = new Set()
  for (const entry of sorted) {
    const ageDays = Math.max(0, Math.floor((now - entry.mtimeMs) / DAY_MS))
    const date = new Date(entry.mtimeMs)
    let bucket
    if (ageDays < daily) bucket = `day:${date.toISOString().slice(0, 10)}`
    else if (ageDays < daily + weekly * 7) bucket = `week:${Math.floor(ageDays / 7)}`
    else {
      const ageMonths = (new Date(now).getUTCFullYear() - date.getUTCFullYear()) * 12 + new Date(now).getUTCMonth() - date.getUTCMonth()
      if (ageMonths < monthly) bucket = `month:${date.toISOString().slice(0, 7)}`
    }
    if (bucket && !buckets.has(bucket)) {
      buckets.add(bucket)
      keep.add(entry.name)
    }
  }
  return {
    keep: sorted.filter(entry => keep.has(entry.name)),
    remove: sorted.filter(entry => !keep.has(entry.name))
  }
}

function parseArgs(argv) {
  const options = { apply: false }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (value === '--apply') options.apply = true
    else if (value === '--root') options.root = argv[++index]
    else if (value === '--latest') options.latest = argv[++index]
    else if (value === '--daily') options.daily = argv[++index]
    else if (value === '--weekly') options.weekly = argv[++index]
    else if (value === '--monthly') options.monthly = argv[++index]
    else throw new Error(`unknown argument: ${value}`)
  }
  if (!options.root || !isAbsolute(options.root)) throw new Error('--root must be an absolute backup directory')
  const root = resolve(options.root)
  if (root === parse(root).root) throw new Error('filesystem root cannot be a backup directory')
  return { ...options, root }
}

export async function applyRetention(options) {
  const names = await readdir(options.root)
  const entries = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const path = resolve(options.root, name)
    const metadata = await lstat(path)
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) entries.push({ name, path, mtimeMs: metadata.mtimeMs })
  }
  const plan = retentionPlan(entries, options)
  if (options.apply) for (const entry of plan.remove) await rm(entry.path, { recursive: true })
  return {
    version: 1,
    applied: Boolean(options.apply),
    policy: {
      latest: integer(options.latest, 5, 'latest'),
      daily: integer(options.daily, 14, 'daily'),
      weekly: integer(options.weekly, 8, 'weekly'),
      monthly: integer(options.monthly, 12, 'monthly')
    },
    kept: plan.keep.map(entry => entry.name),
    removed: plan.remove.map(entry => entry.name)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2))
    console.log(JSON.stringify(await applyRetention(options), null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
