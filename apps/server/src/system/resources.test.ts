import { describe, it, expect } from 'vitest'
import { readMemoryLimitBytes, readCpuCount, type ResourceDeps } from './resources.js'

const GB = 1024 * 1024 * 1024

/** Мок-deps: файлы задаются картой path→содержимое (отсутствие = null). */
function deps(files: Record<string, string>, host = 16 * GB, cpuCount = 8): ResourceDeps {
  return {
    readFile: (p) => (p in files ? files[p] : null),
    totalmem: () => host,
    cpuCount: () => cpuCount
  }
}

describe('readMemoryLimitBytes', () => {
  it('cgroup v2 memory.max с числом → берёт лимит контейнера', () => {
    expect(readMemoryLimitBytes(deps({ '/sys/fs/cgroup/memory.max': '536870912' }))).toBe(512 * 1024 * 1024)
  })

  it("cgroup v2 'max' (без лимита) → откат к памяти хоста", () => {
    expect(readMemoryLimitBytes(deps({ '/sys/fs/cgroup/memory.max': 'max' }, 16 * GB))).toBe(16 * GB)
  })

  it('cgroup v1 limit_in_bytes → берётся, если v2 отсутствует', () => {
    expect(
      readMemoryLimitBytes(deps({ '/sys/fs/cgroup/memory/memory.limit_in_bytes': String(2 * GB) }))
    ).toBe(2 * GB)
  })

  it('v1 sentinel «без лимита» (≈2^63) → откат к памяти хоста', () => {
    expect(
      readMemoryLimitBytes(
        deps({ '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712' }, 16 * GB)
      )
    ).toBe(16 * GB)
  })

  it('нет cgroup-файлов → память хоста', () => {
    expect(readMemoryLimitBytes(deps({}, 4 * GB))).toBe(4 * GB)
  })

  it('v2 имеет приоритет над v1', () => {
    expect(
      readMemoryLimitBytes(
        deps({
          '/sys/fs/cgroup/memory.max': String(1 * GB),
          '/sys/fs/cgroup/memory/memory.limit_in_bytes': String(2 * GB)
        })
      )
    ).toBe(1 * GB)
  })
})

describe('readCpuCount', () => {
  it('cgroup v2 cpu.max "200000 100000" → 2 CPU', () => {
    expect(readCpuCount(deps({ '/sys/fs/cgroup/cpu.max': '200000 100000' }, 16 * GB, 8))).toBe(2)
  })

  it("cgroup v2 'max' → ядра хоста", () => {
    expect(readCpuCount(deps({ '/sys/fs/cgroup/cpu.max': 'max 100000' }, 16 * GB, 8))).toBe(8)
  })

  it('дробная квота округляется и не опускается ниже 1', () => {
    expect(readCpuCount(deps({ '/sys/fs/cgroup/cpu.max': '50000 100000' }, 16 * GB, 8))).toBe(1)
  })

  it('cgroup v1 cfs quota/period', () => {
    expect(
      readCpuCount(
        deps(
          {
            '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '400000',
            '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000'
          },
          16 * GB,
          8
        )
      )
    ).toBe(4)
  })

  it('нет cgroup → ядра хоста', () => {
    expect(readCpuCount(deps({}, 16 * GB, 6))).toBe(6)
  })

  it('квота больше числа ядер хоста → клампится к хосту', () => {
    expect(readCpuCount(deps({ '/sys/fs/cgroup/cpu.max': '1600000 100000' }, 16 * GB, 8))).toBe(8)
  })
})
