import { expect, it } from 'vitest'
import { searchHref, searchText, type SearchTarget } from './universalSearch'

// @testCase TC-SECURITY
it.each([
  'api_key=private-value', 'password: private-value', 'secret=private-value', 'token=private-value',
  'Authorization: Bearer private-value', 'sk-abcdef0123456789', 'ghp_abcdef0123456789',
  '-----BEGIN PRIVATE KEY-----', 'https://user:password@host/private',
  '<script>alert("private-value")</script>', '<svg onload="alert(1)">private-value</svg>'
])('removes unsafe content before matching, including %s', unsafe => {
  expect(searchText('safe\n' + unsafe + '\nvisible')).toBe('safe visible')
})

// @testCase TC-API
it('preserves Unicode and literal punctuation as text', () => {
  expect(searchText('  Найти  файл #42 & "quote"  ')).toBe('Найти файл #42 & "quote"')
  expect(searchText('<b>Найти</b> javascript:alert(1)')).toBe('Найти')
})

// @testCase TC-NAV
it('round-trips every source and encodes IDs and paths as data', () => {
  const id = 'a/b #?кириллица'
  const targets: SearchTarget[] = [
    { source: 'chats', conversationId: id, route: 'chat' },
    { source: 'messages', conversationId: id, messageId: id, route: 'chat' },
    { source: 'projects', projectId: id },
    { source: 'tasks', projectId: id, taskId: id },
    { source: 'files', conversationId: id, path: id },
    { source: 'kb', documentId: id }
  ]
  for (const target of targets) {
    const href = searchHref(target)
    expect(href).toContain(encodeURIComponent(id))
    expect(href.startsWith('#/')).toBe(true)
    if (target.source === 'messages') expect(new URLSearchParams(href.split('?')[1]).get('message')).toBe(id)
    if (target.source === 'files') expect(new URLSearchParams(href.split('?')[1]).get('file')).toBe(id)
  }
})

