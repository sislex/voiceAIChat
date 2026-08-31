import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BranchFlow } from './BranchFlow'

describe('BranchFlow', () => {
  it('направление проговорено словом — стрелку читалка произносит как «больше»', () => {
    render(<BranchFlow from="task/CHAT-248" />)
    const flow = screen.getByTestId('branch-flow')
    expect(flow).toHaveTextContent('task/CHAT-248→сливается вmain')
    expect(flow.querySelector('.vc-branch-flow__arrow')).toHaveAttribute('aria-hidden', 'true')
  })

  it('целевая ветка переопределяется', () => {
    render(<BranchFlow from="fix/a" to="release/1.2" />)
    expect(screen.getByText('release/1.2')).toBeInTheDocument()
  })

  it('подпись об изменениях рисуется отдельной строкой', () => {
    render(<BranchFlow from="fix/a" note="6 файлов изменено · +284 −31" />)
    expect(screen.getByText('6 файлов изменено · +284 −31')).toHaveClass('vc-branch-flow__note')
  })

  it('без подписи лишнего абзаца нет', () => {
    const { container } = render(<BranchFlow from="fix/a" />)
    expect(container.querySelector('.vc-branch-flow__note')).toBeNull()
  })
})
