import { describe, it, expect } from 'vitest'
import { parseDf, parseBattery, isTermux } from './telemetry'

describe('telemetry — parseDf', () => {
  it('разбирает df -kP: размеры из КиБ в байты (Used/Available)', () => {
    const out = [
      'Filesystem     1024-blocks    Used Available Capacity Mounted on',
      '/dev/disk1s1     500000000 300000000 200000000      60% /'
    ].join('\n')
    expect(parseDf(out)).toEqual({ totalBytes: 500000000 * 1024, freeBytes: 200000000 * 1024 })
  })

  it('пустой/битый вывод → undefined', () => {
    expect(parseDf('')).toBeUndefined()
    expect(parseDf('Filesystem 1024-blocks Used Available')).toBeUndefined()
  })
})

describe('telemetry — parseBattery', () => {
  it('CHARGING → charging=true', () => {
    expect(parseBattery(JSON.stringify({ percentage: 87, status: 'CHARGING' }))).toEqual({
      percent: 87,
      charging: true
    })
  })

  it('DISCHARGING → charging=false', () => {
    expect(parseBattery(JSON.stringify({ percentage: 30, status: 'DISCHARGING' }))).toEqual({
      percent: 30,
      charging: false
    })
  })

  it('нет percentage или битый JSON → undefined', () => {
    expect(parseBattery(JSON.stringify({ status: 'FULL' }))).toBeUndefined()
    expect(parseBattery('не json')).toBeUndefined()
  })
})

describe('telemetry — isTermux', () => {
  it('TERMUX_VERSION → true', () => {
    expect(isTermux({ TERMUX_VERSION: '0.118' } as NodeJS.ProcessEnv)).toBe(true)
  })
  it('PREFIX с com.termux → true', () => {
    expect(isTermux({ PREFIX: '/data/data/com.termux/files/usr' } as NodeJS.ProcessEnv)).toBe(true)
  })
  it('обычное окружение без Termux-bin → false', () => {
    expect(isTermux({} as NodeJS.ProcessEnv)).toBe(false)
  })
})
