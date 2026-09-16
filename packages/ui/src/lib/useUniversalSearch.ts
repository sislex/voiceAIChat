import { useEffect, useRef, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { SearchHit, UniversalSearchResult } from '@shared/universalSearch'

const key = (user: string): string => 'vc:search:recent:' + encodeURIComponent(user)
export function recentSearchIds(user: string | undefined): string[] {
  if (!user) return []
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(user)) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && /^(chats|messages|projects|tasks|files|kb):[a-f0-9]{64}$/.test(id)).slice(0, 5) : []
  } catch { return [] }
}
function remember(user: string, id: string): void {
  try { localStorage.setItem(key(user), JSON.stringify([id, ...recentSearchIds(user).filter(item => item !== id)].slice(0, 5))) } catch { /* History is optional. */ }
}
export function useUniversalSearch(api: RendererApi | undefined, open: boolean, user: string | undefined, query: string) {
  const generation = useRef(0)
  const current = useRef({ open, user, query })
  current.current = { open, user, query }
  const [revision, retry] = useState(0)
  const [page, setPage] = useState<UniversalSearchResult | null>(null)
  const [owner, setOwner] = useState({ user, query })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)

  useEffect(() => {
    const version = ++generation.current
    setPage(null); setOwner({ user, query }); setError('')
    busy.current = false
    if (!open || !api || !user) { setLoading(false); return }
    setLoading(true)
    const timer = setTimeout(() => {
      busy.current = true
      void api['search:universal']({ query, recent: recentSearchIds(user) }).then(result => {
        if (version !== generation.current || current.current.user !== user || current.current.query !== query || !current.current.open) return
        setPage(result)
      }).catch(() => {
        if (version === generation.current) setError('Поиск недоступен. Повторите запрос.')
      }).finally(() => {
        if (version === generation.current) { setLoading(false); busy.current = false }
      })
    }, query.trim() ? 200 : 0)
    return () => {
      ++generation.current
      clearTimeout(timer)
      void api['search:cancel']()
    }
  }, [api, open, user, query, revision])

  const valid = open && owner.user === user && owner.query === query
  const visible = valid ? page : null
  const loadMore = async (): Promise<void> => {
    if (!api || !visible?.nextCursor || busy.current) return
    const version = generation.current
    busy.current = true; setLoading(true); setError('')
    try {
      const result = await api['search:universal']({ query, cursor: visible.nextCursor })
      if (version !== generation.current || current.current.query !== query || current.current.user !== user || !current.current.open) return
      setPage(previous => ({
        ...result,
        groups: result.groups.map(group => ({
          ...group,
          hits: Array.from(new Map([...(previous?.groups.find(old => old.source === group.source)?.hits ?? []), ...group.hits].map(hit => [hit.id, hit])).values())
        }))
      }))
    } catch (failure) {
      if (version !== generation.current) return
      if ((failure as { status?: number }).status === 400) retry(value => value + 1)
      else setError('Не удалось загрузить продолжение. Повторите запрос.')
    } finally {
      if (version === generation.current) { busy.current = false; setLoading(false) }
    }
  }
  const select = async (hit: SearchHit, navigate: (href: string) => void): Promise<void> => {
    if (!api || !user) return
    const version = generation.current
    try {
      // Resolve again before navigating; never display a cached deleted/revoked object.
      const result = await api['search:universal']({ query: '', recent: [hit.id] })
      if (version !== generation.current || current.current.user !== user || !current.current.open) return
      const fresh = result.groups.flatMap(group => group.hits).find(item => item.id === hit.id)
      if (!fresh) { setPage(null); setError('Объект удалён или доступ отозван.'); return }
      remember(user, fresh.id)
      navigate(fresh.href)
    } catch { if (version === generation.current) setError('Не удалось открыть результат. Повторите запрос.') }
  }
  return {
    page: visible, loading: valid && loading, error: valid ? error : '',
    retry: () => retry(value => value + 1), loadMore, select
  }
}

