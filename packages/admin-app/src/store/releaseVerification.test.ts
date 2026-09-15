import { expect,it,vi } from 'vitest'
import { verifyPerformanceRelease } from './releaseVerification'
// @testCase T6
it('propagates failed gates and only accepts healthy production with the exact released commit', async () => {
  const expectedCommit='a'.repeat(40)
  const gate=vi.fn(async()=>{})
  const health=vi.fn(async()=>({ok:true,commit:expectedCommit}))
  await expect(verifyPerformanceRelease({expectedCommit,gate,health})).resolves.toBeUndefined()
  expect(gate.mock.invocationCallOrder[0]).toBeLessThan(health.mock.invocationCallOrder[0]!)
  health.mockResolvedValueOnce({ok:true,commit:'b'.repeat(40)})
  await expect(verifyPerformanceRelease({expectedCommit,gate,health})).rejects.toThrow('release commit')
  health.mockResolvedValueOnce({ok:false,commit:expectedCommit})
  await expect(verifyPerformanceRelease({expectedCommit,gate,health})).rejects.toThrow('Production health')
  health.mockClear();gate.mockRejectedValueOnce(new Error('gate failed'))
  await expect(verifyPerformanceRelease({expectedCommit,gate,health})).rejects.toThrow('gate failed')
  expect(health).not.toHaveBeenCalled()
  await expect(verifyPerformanceRelease({expectedCommit:'',gate,health})).rejects.toThrow('full release commit')
})
