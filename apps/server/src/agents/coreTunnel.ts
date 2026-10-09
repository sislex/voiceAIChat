import { Duplex } from 'node:stream'

/** Core endpoint of one TCP connection, with bounded writes and agent flow control. */
export class CoreTunnel extends Duplex {
  private connected = false
  private paused = false
  private pending?: () => void
  private poll: NodeJS.Timeout
  private deadline: NodeJS.Timeout
  constructor(private sendFrame: (frame: Record<string, unknown>) => void, private buffered: () => number, private cleanup: () => void) {
    super()
    this.poll = setInterval(() => this.flush(), 10)
    this.poll.unref()
    this.deadline = setTimeout(() => this.destroy(new Error('Tunnel connection timed out')), 15_000)
    this.deadline.unref()
  }
  frame(frame: { t: string; data?: string; message?: string }): void {
    switch (frame.t) {
      case 'tunnel.connected': this.connected = true; clearTimeout(this.deadline); this.flush(); break
      case 'tunnel.pause': this.paused = true; break
      case 'tunnel.resume': this.paused = false; this.flush(); break
      case 'tunnel.data':
        if (!this.push(Buffer.from(frame.data!, 'base64'))) this.sendFrame({ t: 'tunnel.pause' })
        break
      case 'tunnel.end': this.push(null); break
      case 'tunnel.error': case 'tunnel.connectionError': this.destroy(new Error(frame.message ?? 'Tunnel failed')); break
    }
  }
  private flush(): void {
    if (this.connected && !this.paused && this.buffered() < 256 * 1024) { const pending = this.pending; this.pending = undefined; pending?.() }
  }
  _read(): void { this.sendFrame({ t: 'tunnel.resume' }) }
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    let offset = 0
    const next = () => {
      if (this.destroyed) return done(new Error('Tunnel closed'))
      if (offset === chunk.length) return done()
      const data = chunk.subarray(offset, offset + 32 * 1024); offset += data.length
      this.sendFrame({ t: 'tunnel.data', data: data.toString('base64') })
      this.pending = next
    }
    this.pending = next; this.flush()
  }
  _final(done: () => void): void { this.sendFrame({ t: 'tunnel.end' }); done() }
  _destroy(error: Error | null, done: (error: Error | null) => void): void {
    clearTimeout(this.deadline); clearInterval(this.poll)
    this.sendFrame({ t: 'tunnel.end' }); this.cleanup(); const pending = this.pending; this.pending = undefined; pending?.(); done(error)
  }
}
