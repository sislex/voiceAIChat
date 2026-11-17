// Make on a model API stand: the model has no tools, so project files travel as text. Core reads the
// project through the Make MCP endpoint, puts the files into the prompt, and applies the
// `<make-file>` blocks of the answer through the same endpoint. Snapshots, compile checks and
// `make.changed` therefore work exactly as with model-driven tools.

const TEXT_FILE = /\.(html?|css|m?js|jsx|tsx?|json|svg|md|txt|ya?ml)$/i
const MAX_FILE_BYTES = 60_000
const MAX_TOTAL_BYTES = 150_000
const CALL_TIMEOUT_MS = 30_000
const OPEN = '<make-file'
const CLOSE = '</make-file>'

export interface MakeToolResult { text: string; isError: boolean }
export type MakeToolCall = (name: string, args: Record<string, unknown>) => Promise<MakeToolResult>

/** One stateless JSON-RPC `tools/call` against the Make MCP endpoint. */
export function makeToolCaller(url: string, fetchImpl: typeof fetch = fetch): MakeToolCall {
  return async (name, args) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
    })
    const body = await response.json().catch(() => null) as
      { result?: { content?: { type: string; text?: string }[]; isError?: boolean }; error?: unknown } | null
    if (!response.ok || !body?.result) return { text: `Make HTTP ${response.status}`, isError: true }
    return {
      text: (body.result.content ?? []).map(part => part.text ?? '').join('\n'),
      isError: body.result.isError === true
    }
  }
}

/** Prompt section: the text protocol plus the current project files. Empty when Make is unreachable. */
export async function makeTextFilesPrompt(call: MakeToolCall, readOnly: boolean): Promise<string> {
  let listing: MakeToolResult
  try { listing = await call('make_list_files', {}) } catch { return '' }
  if (listing.isError) return ''
  const files = listing.text.split('\n').flatMap(line => {
    const match = /^(.+) \((\d+) байт\)$/u.exec(line.trim())
    return match ? [{ path: match[1]!, size: Number(match[2]) }] : []
  })
  let budget = MAX_TOTAL_BYTES
  const sections: string[] = []
  for (const file of files) {
    if (!TEXT_FILE.test(file.path) || file.size > MAX_FILE_BYTES || file.size > budget) {
      sections.push(`<make-current-file path="${file.path}" size="${file.size}" omitted="true"/>`)
      continue
    }
    const content = await call('make_read_file', { path: file.path }).catch(() => null)
    if (!content || content.isError) continue
    budget -= file.size
    sections.push(`<make-current-file path="${file.path}">\n${content.text}\n</make-current-file>`)
  }
  const rules = readOnly
    ? 'Сейчас режим «План»: файлы менять нельзя, блоки <make-file> не выводи — ответь по существу или опиши будущие правки.'
    : `Чтобы создать или изменить файл, выведи в ответе блок с ПОЛНЫМ новым содержимым файла (не diff, без обёртки \`\`\`):
<make-file path="css/app.css">
…содержимое…
</make-file>
Чтобы удалить файл: <make-delete path="old.css"/>
Сервер сам запишет блоки в проект, превью у пользователя обновится. Выводи только те файлы, которые меняешь. Вне блоков — короткое пояснение (1–3 предложения), код в нём не повторяй и не проси пользователя сохранять файлы вручную.`
  return `## Мастерская Make: файлы через текст
Ты ассистент мастерской Make: пользователь описывает, что сделать, и видит превью проекта (статический сайт, точка входа — index.html). Инструменты mcp__make__* в этом режиме недоступны — не упоминай и не вызывай их.
${rules}
Текущие файлы проекта:
${sections.length ? sections.join('\n') : '(проект пуст)'}`
}

export interface MakeFileBlocks {
  /** Answer without the blocks. */
  text: string
  files: { path: string; content: string }[]
  deletes: string[]
}

/** A model may still wrap the content in a Markdown fence; the file must not contain it. */
function unfence(content: string): string {
  const match = /^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/u.exec(content)
  return match ? match[1]! : content
}

export function parseMakeFileBlocks(answer: string): MakeFileBlocks {
  const files: MakeFileBlocks['files'] = [], deletes: string[] = []
  let text = answer.replace(/<make-file\s+path="([^"\n]+)"\s*>\n?([\s\S]*?)\n?<\/make-file>/gu, (_all, path: string, content: string) => {
    files.push({ path: path.trim(), content: unfence(content) })
    return ''
  })
  text = text.replace(/<make-delete\s+path="([^"\n]+)"\s*\/?>(?:\s*<\/make-delete>)?/gu, (_all, path: string) => {
    deletes.push(path.trim())
    return ''
  })
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), files, deletes }
}

/** Writes the blocks of an answer into the project and returns the text to keep in the chat. */
export async function applyMakeFileBlocks(call: MakeToolCall, answer: string, readOnly: boolean): Promise<string> {
  const blocks = parseMakeFileBlocks(answer)
  if (!blocks.files.length && !blocks.deletes.length) return answer
  const note = (line: string) => (blocks.text ? `${blocks.text}\n\n` : '') + line
  if (readOnly) return note('Файлы не записаны: в режиме «План» проект менять нельзя.')
  // The last block of a path wins, as a later write would.
  const files = [...new Map(blocks.files.map(file => [file.path, file])).values()]
  let result: MakeToolResult
  try {
    result = files.length
      ? await call('make_apply_changes', { files, ...(blocks.deletes.length ? { delete: blocks.deletes } : {}) })
      : { text: '', isError: false }
    if (!files.length) {
      for (const path of blocks.deletes) {
        const deleted = await call('make_delete_file', { path })
        if (deleted.isError) { result = deleted; break }
      }
    }
  } catch (error) {
    result = { text: error instanceof Error ? error.message : String(error), isError: true }
  }
  if (result.isError) return note(`Не удалось записать файлы проекта: ${result.text.slice(0, 1500)}`)
  const changed = [...files.map(file => `\`${file.path}\``), ...blocks.deletes.map(path => `удалён \`${path}\``)].join(', ')
  const remarks = /\nЗамечания:\n[\s\S]*$/u.exec(result.text)?.[0] ?? ''
  return note(`Файлы проекта обновлены: ${changed}.${remarks.slice(0, 1500)}`)
}

/**
 * Live view of a streamed answer: file contents are replaced by one line per file, so the chat
 * does not render raw markup while the model writes. The saved answer is built from the full text.
 */
export function makeFileStreamFilter(): (delta: string) => string {
  let buffer = '', inside = false
  return delta => {
    buffer += delta
    let out = ''
    for (;;) {
      if (inside) {
        const end = buffer.indexOf(CLOSE)
        if (end < 0) { buffer = buffer.slice(-(CLOSE.length - 1)); return out }
        buffer = buffer.slice(end + CLOSE.length)
        inside = false
        continue
      }
      const start = buffer.indexOf(OPEN)
      if (start < 0) {
        // Hold back a tail that may be the beginning of an opening tag.
        const tail = buffer.lastIndexOf('<')
        const keep = tail >= 0 && OPEN.startsWith(buffer.slice(tail)) ? tail : buffer.length
        out += buffer.slice(0, keep)
        buffer = buffer.slice(keep)
        return out
      }
      const tagEnd = buffer.indexOf('>', start)
      out += buffer.slice(0, start)
      if (tagEnd < 0) { buffer = buffer.slice(start); return out }
      const path = /path="([^"\n]+)"/u.exec(buffer.slice(start, tagEnd))?.[1]
      out += `\n📄 ${path ?? 'файл'}…\n`
      buffer = buffer.slice(tagEnd + 1)
      inside = true
    }
  }
}
