/** Verify the exact released commit after the workflow has deployed it. Never deploys. */
export async function verifyPerformanceRelease(ports: {
  expectedCommit: string
  gate(): Promise<void>
  health(): Promise<{ ok: boolean; commit: string }>
}): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(ports.expectedCommit)) throw new Error('Expected full release commit is required')
  await ports.gate()
  const health = await ports.health()
  if (!health.ok || health.commit !== ports.expectedCommit) throw new Error('Production health does not match the expected release commit')
}
