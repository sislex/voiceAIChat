import { describe, expect, it } from 'vitest'
import { loginEnrollmentDeepLink, parseLoginEnrollmentDeepLink } from './enrollment'

describe('login enrollment deep link', () => {
  it('round-trips only the versioned enrollment protocol', () => {
    const link = loginEnrollmentDeepLink('opaque', 'status-id', 'https://chat.example')
    expect(parseLoginEnrollmentDeepLink(link)).toEqual({ token: 'opaque', statusId: 'status-id', serverUrl: 'https://chat.example' })
  })

  it.each([
    'https://example.test/enroll?token=x',
    'voicechat-login://other?v=1&token=x&status=y&server=https://chat.example',
    'voicechat-login://enroll?v=2&token=x&status=y&server=https://chat.example',
    'voicechat-login://enroll?v=1&token=x&status=y&server=file:///tmp/x',
    'voicechat-login://enroll?v=1&status=y&server=https://chat.example'
  ])('rejects malformed link %s', (link) => {
    expect(parseLoginEnrollmentDeepLink(link)).toBeNull()
  })
})
