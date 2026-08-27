// Проверка пароля по утечкам через HIBP k-anonymity (auth-roadmap п.2, опционально: VC_HIBP_CHECK=1).
// Наружу уходят только первые 5 hex-символов SHA-1 — сам пароль сервис не видит. Любая ошибка сети — fail-open (null):
// вход/создание не должны зависеть от внешнего API.
import { createHash } from 'node:crypto'

export type PwnedFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; text(): Promise<string> }>

export async function pwnedCount(password: string, fetchImpl: PwnedFetch = fetch as unknown as PwnedFetch, timeoutMs = 3000): Promise<number | null> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase()
  const prefix = sha1.slice(0, 5), suffix = sha1.slice(5)
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, { signal: ctl.signal, headers: { 'Add-Padding': 'true', 'User-Agent': 'voiceAIChat' } })
    if (!res.ok) return null
    for (const line of (await res.text()).split('\n')) {
      const [hash, count] = line.trim().split(':')
      if (hash === suffix) return Number(count) || 0
    }
    return 0
  } catch { return null } finally { clearTimeout(t) }
}

export const hibpEnabled = (): boolean => process.env.VC_HIBP_CHECK === '1'
