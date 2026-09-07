import { describe, expect, it } from 'vitest'
import { MachinesMirror } from './machinesMirror.js'

describe('MachinesMirror', () => {
  it('до первого снимка все машины offline; снимок заменяет предыдущий целиком', () => {
    const mirror = new MachinesMirror()
    expect(mirror.isOnline('a')).toBe(false)
    expect(mirror.updatedAt).toBeNull()
    mirror.apply([{ id: 'a', name: 'Mac', platform: 'darwin', policy: { allowedDirs: ['/w'] } as never }], 10)
    expect(mirror.isOnline('a')).toBe(true)
    expect(mirror.nameOf('a')).toBe('Mac')
    expect(mirror.platformOf('a')).toBe('darwin')
    expect(mirror.policyOf('a')?.allowedDirs).toEqual(['/w'])
    expect(mirror.telemetryOf('a')).toBeUndefined()
    expect(mirror.updatedAt).toBe(10)
    mirror.apply([{ id: 'b' }], 20)
    expect(mirror.isOnline('a')).toBe(false)
    expect(mirror.isOnline('b')).toBe(true)
    expect(mirror.size()).toBe(1)
  })
})
