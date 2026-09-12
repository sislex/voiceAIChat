import { createContext, useContext, useRef, useState, type ComponentPropsWithoutRef } from 'react'

export const ChatSearchContext = createContext('')
export function HighlightText({ children }: { children: string }): JSX.Element {
  const query = useContext(ChatSearchContext)
  if (!query) return <>{children}</>
  const parts: JSX.Element[] = []
  let start = 0
  let at = children.toLowerCase().indexOf(query.toLowerCase())
  while (at >= 0) {
    parts.push(<span key={start}>{children.slice(start, at)}<mark data-chat-match="">{children.slice(at, at + query.length)}</mark></span>)
    start = at + query.length
    at = children.toLowerCase().indexOf(query.toLowerCase(), start)
  }
  return <>{parts}{children.slice(start)}</>
}

interface SearchNode { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: SearchNode[] }
function searchPlugin(query: string) {
  return () => (tree: SearchNode): void => {
    if (!query) return
    const visit = (node: SearchNode): void => {
      if (!node.children) return
      node.children = node.children.flatMap((child): SearchNode[] => {
        if (child.type !== 'text' || !child.value) { visit(child); return [child] }
        const text = child.value
        const result: SearchNode[] = []
        let start = 0
        let at = text.toLowerCase().indexOf(query.toLowerCase())
        while (at >= 0) {
          result.push({ type: 'text', value: text.slice(start, at) }, { type: 'element', tagName: 'mark', properties: { 'data-chat-match': '' }, children: [{ type: 'text', value: text.slice(at, at + query.length) }] })
          start = at + query.length
          at = text.toLowerCase().indexOf(query.toLowerCase(), start)
        }
        result.push({ type: 'text', value: text.slice(start) })
        return result
      })
    }
    visit(tree)
  }
}
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import { copyText } from '@voicechat/ui-foundation/lib/clipboard'

// Рендер markdown-ответов Claude. react-markdown по умолчанию не выполняет raw
// HTML (безопасно). Ссылки открываем во внешнем браузере (target=_blank →
// setWindowOpenHandler в main → shell.openExternal).

export interface MarkdownProps {
  children: string
}

/** Блок кода с кнопкой копирования (читает текст из DOM по ref — без парсинга детей). */
function CodeBlock(props: ComponentPropsWithoutRef<'pre'>): JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  const onCopy = (): void => {
    const text = ref.current?.textContent ?? ''
    void copyText(text).then((ok) => {
      setError(!ok)
      setCopied(ok)
      if (ok) setTimeout(() => setCopied(false), 1500)
    }).catch(() => setError(true))
  }
  return (
    <div className="codewrap">
      <button
        className="copycode"
        aria-label="Копировать код"
        title="Копировать код"
        onClick={onCopy}
      >
        {copied ? '✓' : '⧉'}
      </button>
      {error && <span role="alert">Не удалось скопировать код</span>}
      <pre ref={ref} {...props} />
    </div>
  )
}

export function Markdown({ children }: MarkdownProps): JSX.Element {
  const query = useContext(ChatSearchContext)
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }], searchPlugin(query)]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {c}
            </a>
          ),
          pre: (props) => <CodeBlock {...props} />,
          // Чек-лист из GFM (`- [x] пункт`) — это <input type=checkbox disabled>
          // без подписи: у скринридера получалась «флажок, отмечен» без имени, и
          // axe справедливо ругался (правило label, critical). Подпись — само
          // состояние: менять его нельзя, он показывает, что пункт сделан.
          input: ({ type, checked, ...rest }) =>
            type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={checked}
                {...rest}
                aria-label={checked ? 'Пункт выполнен' : 'Пункт не выполнен'}
              />
            ) : (
              <input type={type} {...rest} />
            )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
