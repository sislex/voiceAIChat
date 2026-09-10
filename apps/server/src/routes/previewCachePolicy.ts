type Headers = Record<string, string | string[] | undefined>
const header = (headers: Headers, name: string): string => {
  const key = Object.keys(headers).find(key => key.toLowerCase() === name)
  const value = key === undefined ? undefined : headers[key]
  return Array.isArray(value) ? value.join(',') : value ?? ''
}

/** Кэш ускоряет публичные ресурсы, но не должен фиксировать вход или состояние API. */
export function canReadPreviewCache(method: string, headers: Headers, hasSiteCookies: boolean): boolean {
  return method === 'GET' && !hasSiteCookies
    && !header(headers, 'x-preview-authorization')
    && !/no-cache|no-store|max-age\s*=\s*0/i.test(header(headers, 'cache-control'))
    && !/no-cache/i.test(header(headers, 'pragma'))
    && !header(headers, 'range')
}

export function canStorePreviewCache(headers: Headers): boolean {
  return !header(headers, 'set-cookie') && !header(headers, 'vary')
    && !/private|no-cache|no-store|max-age\s*=\s*0/i.test(header(headers, 'cache-control'))
}
