// Test-child preload: report the address only after the real server owns its socket.
import { Server } from 'node:net'
const listen = Server.prototype.listen
Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const address = this.address()
    if (address && typeof address !== 'string' && process.send) {
      process.send({ type: 'e2e:listening', port: address.port })
    }
  })
  return Reflect.apply(listen, this, args)
}
