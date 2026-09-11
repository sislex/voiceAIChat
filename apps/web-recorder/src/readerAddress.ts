import { READER_PROJECT_ORIGIN } from '@shared/previewProject'
import { PREVIEW_ACTION_LIMITS } from '@shared/previewActions'

function localHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === '[::1]' || host === 'localhost' || host.endsWith('.localhost') || host === 'machine.internal' || host.endsWith('.machine.internal')) return true
  const octets = host.split('.').map(Number)
  return octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (octets[0] === 127 || octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
}

/** Address-bar conveniences are normalized before strict transport validation. */
export function normalizeReaderAddress(value: string, current: string | null): { url: string | null; error?: string } {
  const input = value.trim()
  if (!input) return { url: null }
  if (input.length > PREVIEW_ACTION_LIMITS.url) return { url: null, error: 'Адрес слишком длинный.' }
  try {
    let url: URL
    if (input.startsWith('//')) {
      url = new URL(input, current ?? READER_PROJECT_ORIGIN)
    } else if (/^(?:[/?#]|[.]{1,2}\/)/.test(input)) {
      url = new URL(input, current ?? READER_PROJECT_ORIGIN)
    } else if (/^https?:\/\//i.test(input)) url = new URL(input)
    else {
      const hostPort = /^[^/?#:\s]+:\d{1,5}(?=[/?#]|$)/.test(input)
      if (/^[a-z][a-z\d+.-]*:/i.test(input) && !hostPort) return { url: null, error: 'Поддерживаются адреса http:// и https://.' }
      const candidate = new URL('https://' + input)
      const authority = input.split(/[/?#]/)[0]
      const explicitHttpsPort = /:0*443$/.test(authority)
      const local = !explicitHttpsPort && (localHostname(candidate.hostname) || Boolean(candidate.port))
      url = local ? new URL('http://' + input) : candidate
    }
    if (!/^https?:$/.test(url.protocol) || url.toString().length > PREVIEW_ACTION_LIMITS.url) throw new Error('invalid URL')
    return { url: url.toString() }
  } catch { return { url: null, error: 'Проверьте адрес сайта.' } }
}
