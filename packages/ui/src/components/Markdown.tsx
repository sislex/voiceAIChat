import { useRef, useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import { copyText } from '../lib/clipboard'

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
  const onCopy = (): void => {
    const text = ref.current?.textContent ?? ''
    void copyText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
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
      <pre ref={ref} {...props} />
    </div>
  )
}

export function Markdown({ children }: MarkdownProps): JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {c}
            </a>
          ),
          pre: (props) => <CodeBlock {...props} />
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
