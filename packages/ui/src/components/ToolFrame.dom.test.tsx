import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolFrame } from './ToolFrame'

describe('ToolFrame (общая рамка тулов)', () => {
  it('embedded: разворот на весь экран и обратно', async () => {
    const { container } = render(
      <ToolFrame title="Консоль машины" variant="embedded" testId="tool-embed">
        <p>тело</p>
      </ToolFrame>
    )
    expect(container.querySelector('.util-embed--fs')).toBeNull()
    await userEvent.click(screen.getByTitle('На весь экран'))
    expect(container.querySelector('.util-embed--fs')).not.toBeNull()
    await userEvent.click(screen.getByTitle('Свернуть'))
    expect(container.querySelector('.util-embed--fs')).toBeNull()
  })

  it('modal: тоже разворачивается на весь экран', async () => {
    const { container } = render(
      <ToolFrame title="Проводник Codex" onClose={vi.fn()} testId="tool-overlay">
        <p>тело</p>
      </ToolFrame>
    )
    await userEvent.click(screen.getByTitle('На весь экран'))
    expect(container.querySelector('.ccobs--fs')).not.toBeNull()
  })

  it('modal: клик по фону закрывает, клик внутри — нет', async () => {
    const onClose = vi.fn()
    render(
      <ToolFrame title="Консоль машины" onClose={onClose} testId="tool-overlay">
        <p>тело</p>
      </ToolFrame>
    )
    await userEvent.click(screen.getByText('тело'))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('tool-overlay'))
    expect(onClose).toHaveBeenCalled()
  })

  it('modal: Esc закрывает; из разворота — сначала сворачивает', async () => {
    const onClose = vi.fn()
    const { container } = render(
      <ToolFrame title="Консоль машины" onClose={onClose} testId="tool-overlay">
        <p>тело</p>
      </ToolFrame>
    )
    await userEvent.click(screen.getByTitle('На весь экран'))
    expect(container.querySelector('.ccobs--fs')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(container.querySelector('.ccobs--fs')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('embedded: Esc сворачивает разворот, но не трогает при обычном виде', async () => {
    const { container } = render(
      <ToolFrame title="Консоль машины" variant="embedded" testId="tool-embed">
        <p>тело</p>
      </ToolFrame>
    )
    // без разворота Esc ничего не делает (карточка остаётся)
    await userEvent.keyboard('{Escape}')
    expect(container.querySelector('.util-embed')).not.toBeNull()
    await userEvent.click(screen.getByTitle('На весь экран'))
    expect(container.querySelector('.util-embed--fs')).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(container.querySelector('.util-embed--fs')).toBeNull()
  })

  it('actions рисуются в шапке и знают про разворот', async () => {
    render(
      <ToolFrame
        title="Тул"
        variant="embedded"
        actions={({ fullscreen }) => <button>{fullscreen ? 'развёрнут' : 'свёрнут'}</button>}
      >
        <p>тело</p>
      </ToolFrame>
    )
    expect(screen.getByText('свёрнут')).toBeInTheDocument()
    await userEvent.click(screen.getByTitle('На весь экран'))
    expect(screen.getByText('развёрнут')).toBeInTheDocument()
  })

  it('children-функция получает управление разворотом', async () => {
    const { container } = render(
      <ToolFrame title="Тул" variant="embedded">
        {({ fullscreen, setFullscreen }) => (
          <button onClick={() => setFullscreen(!fullscreen)}>переключить</button>
        )}
      </ToolFrame>
    )
    await userEvent.click(screen.getByText('переключить'))
    expect(container.querySelector('.util-embed--fs')).not.toBeNull()
  })

  it('className добавляется к корню рамки', () => {
    const { container } = render(
      <ToolFrame title="Тул" variant="embedded" className="util-embed--img">
        <p>тело</p>
      </ToolFrame>
    )
    expect(container.querySelector('.util-embed.util-embed--img')).not.toBeNull()
  })

  it('без onClose крестика нет', () => {
    render(
      <ToolFrame title="Тул" variant="embedded">
        <p>тело</p>
      </ToolFrame>
    )
    expect(screen.queryByLabelText('Закрыть')).toBeNull()
  })
})
