import { createServer, type AddressInfo } from 'node:net'

// Let the OS choose from its ephemeral range instead of overlapping fixed ranges.
export async function freePort(): Promise<number> {
  const reservation = createServer()
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', resolve)
  })
  const port = (reservation.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  return port
}
