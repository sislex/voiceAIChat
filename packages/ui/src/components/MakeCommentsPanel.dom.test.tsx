import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { MakeCommentsPanel, commentsPrompt } from './MakeCommentsPanel'
import type { MakeComment } from '@shared/make'

const list: MakeComment[] = [
  { id: 'c1', selector: 'h1', elementLabel: '<h1> Счётчик', text: 'Крупнее', author: 'admin', createdAt: 1, resolved: false },
  { id: 'c2', selector: '.btn', elementLabel: '<button> +', text: 'Синий', author: 'admin', createdAt: 2, resolved: true }
]

describe('MakeCommentsPanel', () => {
  it('нумерует только открытые, подсвечивает, решает, удаляет и собирает промпт', async () => {
    const onAdd = vi.fn(async () => {}); const onResolve = vi.fn(); const onRemove = vi.fn(); const onHighlight = vi.fn(); const onAsk = vi.fn()
    render(<MakeCommentsPanel comments={list} selected={{ selector: 'p.lead', tag: 'p', text: 'Текст' }} onAdd={onAdd} onResolve={onResolve} onRemove={onRemove} onHighlight={onHighlight} onAskAssistant={onAsk} onClose={() => {}} />)
    expect(screen.getByText('1 открытых · 1 решено')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Показать элемент комментария 1' }))
    expect(onHighlight).toHaveBeenCalledWith('h1')
    await userEvent.click(screen.getByRole('button', { name: 'Решено' }))
    expect(onResolve).toHaveBeenCalledWith('c1', true)
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть' }))
    expect(onResolve).toHaveBeenCalledWith('c2', false)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить комментарий Синий' }))
    expect(onRemove).toHaveBeenCalledWith('c2')
    await userEvent.type(screen.getByLabelText('Текст комментария'), 'Сделай курсивом')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(onAdd).toHaveBeenCalledWith('Сделай курсивом')
    await userEvent.click(screen.getByRole('button', { name: 'Исправить все' }))
    expect(onAsk).toHaveBeenCalledWith(commentsPrompt(list))
    expect(commentsPrompt(list)).toContain('1. <h1> Счётчик (селектор `h1`): Крупнее')
    expect(commentsPrompt(list)).not.toContain('Синий')
  })

  it('без выбранного элемента форма отключена', () => {
    render(<MakeCommentsPanel comments={[]} selected={null} onAdd={async () => {}} onResolve={() => {}} onRemove={() => {}} onHighlight={() => {}} onClose={() => {}} />)
    expect(screen.getByLabelText('Текст комментария')).toBeDisabled()
    expect(screen.getByText('Комментариев пока нет')).toBeInTheDocument()
  })
})
