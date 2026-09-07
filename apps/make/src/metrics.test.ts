import { describe, expect, it } from 'vitest'
import { formatMakeMetrics } from './metrics'

describe('formatMakeMetrics', () => {
  it('выдаёт Prometheus-экспозицию с метками пользователей и экранированием', () => {
    const text = formatMakeMetrics({ projects: 2, bytes: 300, filesBytes: 100, snapshotsBytes: 200, shotsBytes: 0, published: 1, shared: 0, views: 5, limitBytes: 64, userLimitBytes: 512, byUser: [{ user: 'a"b', projects: 2, bytes: 300, published: 1, views: 5 }], top: [] })
    expect(text).toContain('# TYPE voicechat_make_projects gauge\nvoicechat_make_projects 2')
    expect(text).toContain('voicechat_make_bytes_total 300')
    expect(text).toContain('voicechat_make_user_bytes{user="a\\"b"} 300')
    expect(text.endsWith('\n')).toBe(true)
  })
})
