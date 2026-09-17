import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { runAxe } from '../test/a11y.js'
import { ToolFrame } from './ToolFrame'

describe('ToolFrame (общая рамка тулов)', () => {
  // @testCase TC-UI-1
  it('keeps Escape on the wizard when the empty chat page mounts underneath it', async () => {
    const close = vi.fn()
    const wizard = <ToolFrame title="Wizard" onClose={close}><p>Setup</p></ToolFrame>
    const view = render(<>{wizard}</>)
    view.rerender(<>{wizard}<ToolFrame title="Chats" variant="page"><p>No chats yet</p></ToolFrame></>)
    await userEvent.keyboard('{Escape}')
    expect(close).toHaveBeenCalledTimes(1)
  })

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

  it('кнопки шапки подписаны тултипом (не только aria-label)', async () => {
    render(
      <ToolFrame title="Тул" variant="embedded" onClose={vi.fn()}>
        <p>тело</p>
      </ToolFrame>
    )
    expect(screen.getByLabelText('Закрыть')).toHaveAttribute('title', 'Закрыть')
    // Разворот подписан по состоянию: до и после клика текст разный.
    expect(screen.getByTitle('На весь экран')).toBeInTheDocument()
    await userEvent.click(screen.getByTitle('На весь экран'))
    expect(screen.getByTitle('Свернуть')).toBeInTheDocument()
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

describe('axe serialization', () => {
  // @testCase TC-REG-03
  it('serializes concurrent analyses in one document', async () => {
    let active = 0
    let maximum = 0
    const run = vi.spyOn(axe, 'run') as unknown as ReturnType<typeof vi.fn>
    run.mockImplementation(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      active -= 1
      return { violations: [] }
    })

    await Promise.all([runAxe(), runAxe(), runAxe()])

    expect(run).toHaveBeenCalledTimes(3)
    expect(maximum).toBe(1)
    run.mockRestore()
  })

  // @testCase TC-NEG-04
  it('releases the queue when an analysis fails', async () => {
    const run = vi.spyOn(axe, 'run') as unknown as ReturnType<typeof vi.fn>
    run.mockRejectedValueOnce(new Error('analysis failed'))
      .mockResolvedValueOnce({ violations: [] })

    await expect(runAxe()).rejects.toThrow('analysis failed')
    await expect(runAxe()).resolves.toEqual([])
    expect(run).toHaveBeenCalledTimes(2)
    run.mockRestore()
  })
})
