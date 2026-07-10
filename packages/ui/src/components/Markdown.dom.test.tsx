import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from './Markdown'

describe('Markdown', () => {
  it('рендерит эмфазу, инлайн-код и заголовки как элементы', () => {
    const { container } = render(
      <Markdown>{'# Заголовок\n\nЭто **важно** и `код`.'}</Markdown>
    )
    expect(container.querySelector('h1')?.textContent).toBe('Заголовок')
    expect(container.querySelector('strong')?.textContent).toBe('важно')
    expect(container.querySelector('code')?.textContent).toBe('код')
  })

  it('рендерит списки', () => {
    const { container } = render(<Markdown>{'- раз\n- два'}</Markdown>)
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('блок кода рендерится в pre с подсветкой (класс hljs)', () => {
    const { container } = render(<Markdown>{'```js\nconst x = 1\n```'}</Markdown>)
    const code = container.querySelector('pre code')
    expect(code?.textContent).toContain('const x = 1')
    expect(code?.className).toContain('hljs') // rehype-highlight отработал
  })

  it('ссылки открываются во внешнем окне (target=_blank)', () => {
    render(<Markdown>{'[клик](https://example.com)'}</Markdown>)
    const link = screen.getByText('клик') as HTMLAnchorElement
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('href')).toBe('https://example.com')
  })
})
