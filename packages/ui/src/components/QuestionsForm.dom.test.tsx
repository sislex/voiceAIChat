import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuestionsForm } from './QuestionsForm'
import type { QuestionSpec } from '@shared/questions'

const QUESTIONS: QuestionSpec[] = [
  { q: 'Какую БД использовать?', options: ['SQLite', 'Postgres'] },
  { q: 'Что включить?', options: ['Тесты', 'Логи'], multi: true }
]

describe('QuestionsForm', () => {
  it('кнопка выключена, пока отвечены не все вопросы; сабмит собирает текст', () => {
    const onSubmit = vi.fn()
    render(<QuestionsForm questions={QUESTIONS} onSubmit={onSubmit} />)

    const btn = screen.getByRole('button', { name: 'Отправить ответы' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Отвечено 0 из 2')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('SQLite'))
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Отвечено 1 из 2')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Тесты'))
    fireEvent.click(screen.getByLabelText('Логи'))
    expect((btn as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(btn)
    expect(onSubmit).toHaveBeenCalledWith(
      '1. Какую БД использовать? — SQLite\n2. Что включить? — Тесты; Логи'
    )
  })

  it('радио: второй клик переключает, а не добавляет', () => {
    const onSubmit = vi.fn()
    render(<QuestionsForm questions={[QUESTIONS[0]]} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByLabelText('SQLite'))
    fireEvent.click(screen.getByLabelText('Postgres'))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить ответы' }))
    expect(onSubmit).toHaveBeenCalledWith('Postgres')
  })

  it('свой вариант считается ответом и попадает в текст', () => {
    const onSubmit = vi.fn()
    render(<QuestionsForm questions={[QUESTIONS[0]]} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Свой вариант: Какую БД использовать?'), {
      target: { value: 'MySQL' }
    })
    const btn = screen.getByRole('button', { name: 'Отправить ответы' })
    expect((btn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(btn)
    expect(onSubmit).toHaveBeenCalledWith('MySQL')
  })

  it('disabled: форма и кнопка неактивны', () => {
    const onSubmit = vi.fn()
    render(<QuestionsForm questions={[QUESTIONS[0]]} onSubmit={onSubmit} disabled />)
    fireEvent.click(screen.getByLabelText('SQLite'))
    const btn = screen.getByRole('button', { name: 'Отправить ответы' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})
