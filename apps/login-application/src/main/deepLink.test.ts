import { describe, expect, it } from 'vitest'
import { parseLoginEnrollmentDeepLink } from '@shared/enrollment'

describe('Electron custom protocol input', () => {
  it('accepts cold-start and second-instance URL shape', () => {
    const uri = 'voicechat-login://enroll?v=1&token=secret&status=correlation&server=https%3A%2F%2Fchat.example'
    expect(parseLoginEnrollmentDeepLink(uri)).toEqual({
      token: 'secret', statusId: 'correlation', serverUrl: 'https://chat.example'
    })
  })

  it('rejects missing secret and another protocol', () => {
    expect(parseLoginEnrollmentDeepLink('voicechat-login://enroll?v=1&status=x&server=https://chat.example')).toBeNull()
    expect(parseLoginEnrollmentDeepLink('voicechat-agent://enroll?v=1&token=x&status=y&server=https://chat.example')).toBeNull()
  })
})
