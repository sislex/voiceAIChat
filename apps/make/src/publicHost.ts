// SSRF-гард импорта по URL: Make ходит только на публичные адреса — ни loopback, ни приватных
// сетей, ни link-local. Тот же гард держит Web Reader ядра (`apps/server/src/util/publicHost.ts`);
// копия намеренная: 25 строк без владельца не стоят зависимости между сервисами в обе стороны.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class PublicHostError extends Error {}

export function isPublicAddress(address: string): boolean {
  const v = address.toLowerCase().replace(/^::ffff:/, '')
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224)
  }
  if (isIP(v) === 6) return !(v === '::1' || v === '::' || v.startsWith('fe80:') || /^(fc|fd)[0-9a-f]{2}:/.test(v))
  return false
}

/** Литерал IP проверяется сразу, имя — по всем адресам DNS: один приватный адрес в ответе запрещает хост целиком. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const literal = hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) throw new PublicHostError('Адрес сайта недоступен для превью')
    return
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new PublicHostError('Адрес сайта недоступен для превью')
}
