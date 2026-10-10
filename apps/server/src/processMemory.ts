/** Process-wide memory samples in MiB, independent of request logging. */
export function startProcessMemoryLogger(
  log: (line: string) => void = console.log,
  memoryUsage: () => NodeJS.MemoryUsage = process.memoryUsage,
): () => void {
  const timer = setInterval(() => {
    const usage = memoryUsage()
    const mib = (bytes: number): number => Math.round(bytes / 1024 / 1024 * 100) / 100
    log(JSON.stringify({
      event: 'process_memory',
      rss: mib(usage.rss), heapUsed: mib(usage.heapUsed), heapTotal: mib(usage.heapTotal),
      external: mib(usage.external), arrayBuffers: mib(usage.arrayBuffers),
    }))
  }, 5 * 60_000)
  timer.unref()
  return () => clearInterval(timer)
}
