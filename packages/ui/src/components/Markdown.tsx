import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'

// Рендер markdown-ответов Claude. react-markdown по умолчанию не выполняет raw
// HTML (безопасно). Ссылки открываем во внешнем браузере (target=_blank →
// setWindowOpenHandler в main → shell.openExternal).

export interface MarkdownProps {
  children: string
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
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
