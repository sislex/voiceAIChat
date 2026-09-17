import { describe, expect, it } from 'vitest'
import { RECENT_ADDRESSES_LIMIT, loadRecentAddresses, recentAddressLabel, rememberRecentAddress, saveRecentAddresses } from './recentAddresses'

describe('recentAddresses', () => {
  it('keeps newest first, deduplicates and drops credentials and fragments', () => {
    const list = rememberRecentAddress(['https://a.test/'], 'https://user:pw@b.test/page#frag')
    expect(list).toEqual(['https://b.test/page', 'https://a.test/'])
    expect(rememberRecentAddress(list, 'https://a.test/')).toEqual(['https://a.test/', 'https://b.test/page'])
  })

  it('ignores non-http and malformed addresses and caps the list', () => {
    expect(rememberRecentAddress(['https://a.test/'], 'javascript:alert(1)')).toEqual(['https://a.test/'])
    expect(rememberRecentAddress([], 'not a url')).toEqual([])
    let list: string[] = []
    for (let index = 0; index < 10; index++) list = rememberRecentAddress(list, `https://site${index}.test/`)
    expect(list).toHaveLength(RECENT_ADDRESSES_LIMIT)
    expect(list[0]).toBe('https://site9.test/')
  })

  it('survives broken storage content and round-trips through storage', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
    expect(loadRecentAddresses({ getItem: () => '{oops' })).toEqual([])
    expect(loadRecentAddresses({ getItem: () => JSON.stringify([1, 'https://ok.test/']) })).toEqual(['https://ok.test/'])
    saveRecentAddresses(['https://x.test/'], storage)
    expect(loadRecentAddresses(storage)).toEqual(['https://x.test/'])
  })

  it('labels chips by host and path without the scheme', () => {
    expect(recentAddressLabel('https://shop.example/')).toBe('shop.example')
    expect(recentAddressLabel('https://shop.example/catalog?page=2')).toBe('shop.example/catalog?page=2')
    expect(recentAddressLabel('https://shop.example/' + 'a'.repeat(60))).toHaveLength(42)
  })
})
