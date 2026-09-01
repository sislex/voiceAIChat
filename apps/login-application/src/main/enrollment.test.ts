import { describe, expect, it, vi } from 'vitest'
import { enrollWithDeepLink, loginAndCreateMachine } from './enrollment'

describe('login application enrollment', () => {
  it('redeems a deep link without putting a permanent token in the URI', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      machineToken: 'permanent', serverUrl: 'https://chat.example'
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const link = 'voicechat-login://enroll?v=1&token=opaque&status=s&server=https%3A%2F%2Fchat.example'
    await expect(enrollWithDeepLink(link, request, 'Mac')).resolves.toEqual({
      machineToken: 'permanent', serverUrl: 'wss://chat.example/agent'
    })
    expect(String(request.mock.calls[0]?.[1]?.body)).toContain('opaque')
    expect(link).not.toContain('permanent')
  })

  it('logs in without retaining the password and creates the current machine', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'session' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'machine' }), { status: 200 }))
    const input = { serverUrl: 'https://chat.example/path', login: 'alice', password: 'secret' }
    await expect(loginAndCreateMachine(input, request, 'Mac')).resolves.toEqual({
      machineToken: 'machine', serverUrl: 'wss://chat.example/agent'
    })
    expect(request.mock.calls[1]?.[1]?.headers).toEqual(expect.objectContaining({ authorization: 'Bearer session' }))
    expect(input.password).toBe('secret')
  })

  it('rejects malformed deep links before network access', async () => {
    const request = vi.fn<typeof fetch>()
    await expect(enrollWithDeepLink('https://example.test', request, 'Mac')).rejects.toThrow('Некорректная')
    expect(request).not.toHaveBeenCalled()
  })
})
