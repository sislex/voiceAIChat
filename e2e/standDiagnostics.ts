import type { ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

/** Keep the last 80 lines; discard oversized lines rather than leaking partial secrets. */
export class StandDiagnostics {
  private lines: string[] = []
  private pending = new Map<string, string>()
  private oversized = new Set<string>()
  private failure = ''
  constructor(private secrets: string[], private echo = false) {}

  private redact(text: string): string {
    for (const secret of this.secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      text = text.split(secret).join('[REDACTED]')
    }
    return text
  }

  private record(stream: string, line: string): void {
    const safe = `[${stream}] ${this.redact(line)}`
    this.lines.push(safe)
    if (this.lines.length > 80) this.lines.shift()
    if (this.echo) process.stderr.write(safe + '\n')
  }

  write(stream: string, chunk: string): void {
    const parts = chunk.split('\n')
    for (let i = 0; i < parts.length; i++) {
      const line = (this.pending.get(stream) ?? '') + parts[i]
      if (line.length > 8192) this.oversized.add(stream)
      this.pending.set(stream, this.oversized.has(stream) ? '' : line)
      if (i < parts.length - 1) this.end(stream)
    }
  }

  end(stream: string): void {
    const rest = this.pending.get(stream) ?? ''
    if (this.oversized.has(stream)) this.record(stream, '[oversized line omitted]')
    else if (rest) this.record(stream, rest)
    this.pending.delete(stream)
    this.oversized.delete(stream)
  }

  attach(child: ChildProcess): void {
    for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
      const decoder = new StringDecoder('utf8')
      stream?.on('data', chunk => this.write(name, decoder.write(chunk)))
      stream?.on('end', () => { this.write(name, decoder.end()); this.end(name) })
    }
    child.on('error', error => { this.failure = this.redact(error.message) })
  }

  error(message: string): Error {
    const partial = [...this.pending].map(([stream, value]) => `[${stream}] ${this.oversized.has(stream) ? '[oversized line omitted]' : this.redact(value)}`)
    return new Error(this.redact(message) + '\n' + [...this.lines, ...partial].slice(-80).join('\n'))
  }

  async waitFor(url: string, what: string, child: ChildProcess, seconds = 90): Promise<void> {
    const deadline = Date.now() + seconds * 1000
    let health = 'no response'
    while (Date.now() < deadline) {
      if (this.failure) throw this.error(`${what}: ${this.failure}`)
      if (child.exitCode !== null || child.signalCode !== null) {
        await new Promise(resolve => setTimeout(resolve, 20))
        throw this.error(`${what} завершился с кодом ${child.exitCode}, сигнал ${child.signalCode}`)
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))) })
        health = `HTTP ${response.status}`
        await response.body?.cancel()
        if (response.ok) return
      } catch (error) { health = String(error) }
      await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))))
    }
    throw this.error(`${what} не поднялся за ${seconds} с: ${url}; ${health}`)
  }
}
