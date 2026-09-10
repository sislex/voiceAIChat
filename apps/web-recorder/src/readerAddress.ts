import { READER_PROJECT_ORIGIN } from '@shared/previewProject'
import { PREVIEW_ACTION_LIMITS } from '@shared/previewActions'

/** Адресная строка принимает привычный ввод; сообщения моста остаются строгими HTTP URL. */
export function normalizeReaderAddress(value: string, current: string | null): { url: string | null; error?: string } {
  const input = value.trim()
  if (!input) return { url: null }
  if (input.length > PREVIEW_ACTION_LIMITS.url) return { url: null, error: 'Адрес слишком длинный.' }
  try {
    let url: URL
    if (/^(?:[/?#]|[.]{1,2}\/)/.test(input) && !input.startsWith('//')) {
      url = new URL(input, current ?? READER_PROJECT_ORIGIN)
    } else if (/^https?:\/\//i.test(input)) url = new URL(input)
    else {
      const hostPort = /^[^/?#:\s]+:\d{1,5}(?=[/?#]|$)/.test(input)
      if (/^[a-z][a-z\d+.-]*:/i.test(input) && !hostPort) return { url: null, error: 'Поддерживаются адреса http:// и https://.' }
      const host = input.replace(/^\/\//, '').split(/[/?#]/)[0]
      const local = /^(?:localhost|(?:[^:]+\.)?machine\.internal)(?::\d+)?$/i.test(host) || /:\d+$/.test(host) && !host.endsWith(':443')
      url = new URL((local ? 'http://' : 'https://') + input.replace(/^\/\//, ''))
    }
    if (!/^https?:$/.test(url.protocol) || url.toString().length > PREVIEW_ACTION_LIMITS.url) throw new Error('invalid URL')
    return { url: url.toString() }
  } catch { return { url: null, error: 'Проверьте адрес сайта.' } }
}
