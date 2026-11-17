import { expect, it } from 'vitest'
import { applyMakeFileBlocks, makeFileStreamFilter, makeTextFilesPrompt, makeToolCaller, parseMakeFileBlocks, type MakeToolCall } from './makeTextFiles.js'

const answer = 'Сделал страницу.\n<make-file path="index.html">\n<h1>Hi</h1>\n</make-file>\n<make-file path="notes.md">\n```md\n# Notes\n```\n</make-file>\n<make-delete path="old.css"/>\nГотово.'

function tools(results: Record<string, { text: string; isError?: boolean }>) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const call: MakeToolCall = async (name, args) => {
    calls.push({ name, args })
    const result = results[name === 'make_read_file' ? `read:${String(args.path)}` : name] ?? { text: '' }
    return { text: result.text, isError: result.isError === true }
  }
  return { call, calls }
}

it('puts the protocol and the current text files of the project into the prompt', async () => {
  const { call } = tools({
    make_list_files: { text: 'index.html (20 байт)\nlogo.png (900 байт)\nbig.js (999999 байт)' },
    'read:index.html': { text: '<h1>Old</h1>' }
  })
  const prompt = await makeTextFilesPrompt(call, false)
  expect(prompt).toContain('<make-file path="css/app.css">')
  expect(prompt).toContain('<make-current-file path="index.html">\n<h1>Old</h1>\n</make-current-file>')
  expect(prompt).toContain('<make-current-file path="logo.png" size="900" omitted="true"/>')
  expect(prompt).toContain('<make-current-file path="big.js" size="999999" omitted="true"/>')
  expect(await makeTextFilesPrompt(call, true)).toContain('блоки <make-file> не выводи')
})

it('stays silent when Make cannot be reached', async () => {
  expect(await makeTextFilesPrompt(async () => { throw new Error('offline') }, false)).toBe('')
  expect(await makeTextFilesPrompt(tools({ make_list_files: { text: 'nope', isError: true } }).call, false)).toBe('')
})

it('takes file and delete blocks out of the answer', () => {
  expect(parseMakeFileBlocks(answer)).toEqual({
    text: 'Сделал страницу.\n\nГотово.',
    files: [{ path: 'index.html', content: '<h1>Hi</h1>' }, { path: 'notes.md', content: '# Notes' }],
    deletes: ['old.css']
  })
  expect(parseMakeFileBlocks('Просто ответ')).toEqual({ text: 'Просто ответ', files: [], deletes: [] })
})

it('writes the blocks in one transaction and keeps a short summary in the chat', async () => {
  const { call, calls } = tools({ make_apply_changes: { text: 'Записано файлов: 2, удалено: 1. Файлов в проекте: 3.\nЗамечания:\n- index.html: нет <title>' } })
  const text = await applyMakeFileBlocks(call, answer, false)
  expect(calls).toEqual([{ name: 'make_apply_changes', args: {
    files: [{ path: 'index.html', content: '<h1>Hi</h1>' }, { path: 'notes.md', content: '# Notes' }], delete: ['old.css'] } }])
  expect(text).toBe('Сделал страницу.\n\nГотово.\n\nФайлы проекта обновлены: `index.html`, `notes.md`, удалён `old.css`.\nЗамечания:\n- index.html: нет <title>')
})

it('reports a rejected write, leaves an answer without blocks alone and never writes in plan mode', async () => {
  const failing = tools({ make_apply_changes: { text: 'Изменения откачены: ошибка компиляции.', isError: true } })
  expect(await applyMakeFileBlocks(failing.call, answer, false)).toContain('Не удалось записать файлы проекта: Изменения откачены')
  const idle = tools({})
  expect(await applyMakeFileBlocks(idle.call, 'Просто ответ', false)).toBe('Просто ответ')
  expect(await applyMakeFileBlocks(idle.call, answer, true)).toContain('Файлы не записаны')
  expect(idle.calls).toEqual([])
  const deleting = tools({})
  expect(await applyMakeFileBlocks(deleting.call, '<make-delete path="a.css"/>', false)).toBe('Файлы проекта обновлены: удалён `a.css`.')
  expect(deleting.calls).toEqual([{ name: 'make_delete_file', args: { path: 'a.css' } }])
})

it('hides file contents from the live stream whatever the chunk boundaries are', () => {
  for (const size of [1, 3, 7, 1000]) {
    const live = makeFileStreamFilter()
    let seen = ''
    for (let i = 0; i < answer.length; i += size) seen += live(answer.slice(i, i + size))
    expect(seen.replace(/\n+/g, '\n')).toBe('Сделал страницу.\n📄 index.html…\n📄 notes.md…\n<make-delete path="old.css"/>\nГотово.')
  }
  expect(makeFileStreamFilter()('a < b')).toBe('a < b')
})

it('calls a Make tool with one stateless JSON-RPC request', async () => {
  const requests: { url: string; body: unknown }[] = []
  const call = makeToolCaller('http://make/mcp/make?k=s&conv=c', (async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })
    return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }], isError: true } })
  }) as typeof fetch)
  expect(await call('make_delete_file', { path: 'a' })).toEqual({ text: 'ok', isError: true })
  expect(requests).toEqual([{ url: 'http://make/mcp/make?k=s&conv=c',
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'make_delete_file', arguments: { path: 'a' } } } }])
  expect(await makeToolCaller('http://make', (async () => new Response('no', { status: 403 })) as typeof fetch)('x', {}))
    .toEqual({ text: 'Make HTTP 403', isError: true })
})
