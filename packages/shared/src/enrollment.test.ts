import { describe, expect, it } from 'vitest'
import { loginEnrollmentDeepLink, parseLoginEnrollmentDeepLink } from './enrollment'

describe('login enrollment deep link', () => {
  it('round-trips only the versioned enrollment protocol', () => {
    const link = loginEnrollmentDeepLink('opaque', 'status-id', 'https://chat.example')
    expect(parseLoginEnrollmentDeepLink(link)).toEqual({ token: 'opaque', statusId: 'status-id', serverUrl: 'https://chat.example' })
  })

  it.each([
    ['https://chat.example', true],
    ['http://localhost:8787', true],
    ['http://127.0.0.1:8787', true],
    ['http://127.12.3.4:8787', true],
    ['http://[::1]:8787', true],
    ['http://chat.example', false],
    ['http://192.168.1.20', false],
    ['file:///tmp/x', false]
  ])('applies the enrollment origin policy to %s', (origin, accepted) => {
    const link = loginEnrollmentDeepLink('opaque', 'status-id', origin)
    expect(Boolean(parseLoginEnrollmentDeepLink(link))).toBe(accepted)
  })

  it('accepts legacy query names during rollout', () => {
    expect(parseLoginEnrollmentDeepLink(
      'voicechat-login://enroll?v=1&token=opaque&status=status-id&server=https%3A%2F%2Fchat.example'
    )).toEqual({ token: 'opaque', statusId: 'status-id', serverUrl: 'https://chat.example' })
  })

  it.each([
    'https://example.test/enroll?secret=x',
    'voicechat-login://other?v=1&secret=x&correlationId=y&origin=https://chat.example',
    'voicechat-login://enroll?v=2&secret=x&correlationId=y&origin=https://chat.example',
    'voicechat-login://enroll?v=1&secret=x&correlationId=y&origin=file:///tmp/x',
    'voicechat-login://enroll?v=1&correlationId=y&origin=https://chat.example'
  ])('rejects malformed link %s', (link) => {
    expect(parseLoginEnrollmentDeepLink(link)).toBeNull()
  })
})
