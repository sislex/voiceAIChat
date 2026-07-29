import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import axe from 'axe-core'
import { PromptBuilder, type PromptBuilderProps, type Suggestion } from './PromptBuilder'
import type { ModifierPrompt } from '@shared/types'

const prompts: ModifierPrompt[] = [
  { id: 'a', title: 'Первый', text: 'Сделай кратко', enabled: true },
  { id: 'b', title: 'Второй', text: 'Официальный тон', enabled: false },
  { id: 'c', title: 'Системный', text: 'Сохрани смысл', enabled: true, readonly: true }
]
const suggestions: Suggestion[] = [{ id: 's1', text: 'Первый вариант' }, { id: 's2', text: 'Второй вариант' }]
function setup(overrides: Partial<PromptBuilderProps> = {}) {
  const generate = vi.fn(async (_params: import('./PromptBuilder').GenerateParams) => suggestions)
  const props: PromptBuilderProps = { open: true, prompts, generate, onApply: vi.fn(), onClose: vi.fn(), debounceMs: 0, ...overrides }
  return { ...render(<PromptBuilder {...props}/>), props, generate, user: userEvent.setup() }
}
async function generateReady(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Что нужно сформулировать'), 'описание')
  await screen.findByText('Первый вариант')
}

describe('PromptBuilder', () => {
  it('debounce вызывает generate с активными модификаторами в исходном порядке', async () => {
    const { generate } = setup()
    fireEvent.change(screen.getByLabelText('Что нужно сформулировать'), { target: { value: 'текст' } })
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    expect(generate.mock.calls[0][0].modifiers.map((p: ModifierPrompt) => p.id)).toEqual(['a', 'c'])
  })
  it('добавляет, удаляет варианты и собирает превью', async () => {
    const { user } = setup({ joinSeparator: ' | ' })
    await generateReady(user)
    const first = screen.getByText('Первый вариант').closest('article')!
    await user.click(within(first).getByText('Добавить'))
    const second = screen.getByText('Второй вариант').closest('article')!
    await user.click(within(second).getByText('Добавить'))
    expect(screen.getByTestId('prompt-preview')).toHaveTextContent('Первый вариант | Второй вариант')
    await user.click(within(first).getByLabelText(/Удалить:/))
    expect(screen.queryAllByText('Первый вариант')).toHaveLength(1)
  })
  it('перемещает абзацы и применяет склеенный результат', async () => {
    const onApply = vi.fn(), onClose = vi.fn(); const { user } = setup({ onApply, onClose })
    await generateReady(user)
    await user.click(within(screen.getByText('Первый вариант').closest('article')!).getByText('Добавить'))
    await user.click(within(screen.getByText('Второй вариант').closest('article')!).getByText('Добавить'))
    const block = screen.getAllByText('Второй вариант').at(-1)!.closest('article')!
    await user.click(within(block).getByText('Вверх'))
    expect(screen.getByTestId('prompt-preview')).toHaveTextContent('Второй вариант Первый вариант')
    await user.click(screen.getByText('Применить'))
    expect(onApply).toHaveBeenCalledWith('Второй вариант\n\nПервый вариант'); expect(onClose).toHaveBeenCalled()
  })
  it('на доработку удаляет единственный абзац и переносит его в prompt', async () => {
    const { user } = setup(); await generateReady(user)
    await user.click(within(screen.getByText('Первый вариант').closest('article')!).getByText('Добавить'))
    await user.click(within(screen.getAllByText('Первый вариант').at(-1)!.closest('article')!).getByText('На доработку'))
    expect(screen.getByLabelText('Что нужно сформулировать')).toHaveValue('Первый вариант')
    expect(screen.queryByTestId('prompt-preview')).not.toBeInTheDocument()
  })
  it('сохраняет сборку при переходе в настройки и скрывает CRUD readonly', async () => {
    const { user } = setup(); await generateReady(user)
    await user.click(within(screen.getByText('Первый вариант').closest('article')!).getByText('Добавить'))
    await user.click(screen.getByLabelText('Настройки'))
    const readonly = screen.getByText('Системный').closest('article')!
    expect(within(readonly).queryByText('Изменить')).not.toBeInTheDocument(); expect(within(readonly).queryByText('Удалить')).not.toBeInTheDocument()
    await user.click(screen.getByText('Назад'))
    expect(screen.getByTestId('prompt-preview')).toHaveTextContent('Первый вариант')
  })
  it('валидирует новый промпт и сообщает изменения наружу', async () => {
    const onPromptsChange = vi.fn(); const { user } = setup({ onPromptsChange })
    await user.click(screen.getByLabelText('Настройки')); await user.click(screen.getByText('Добавить промпт'))
    expect(screen.getByText('Сохранить')).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('Введите текст')
    await user.type(screen.getByLabelText('Название'), 'Новый'); await user.type(screen.getByLabelText('Текст промпта'), 'Добавь призыв')
    await user.click(screen.getByText('Сохранить'))
    expect(onPromptsChange).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ title: 'Новый', text: 'Добавь призыв' })]))
  })
  it('без onPromptsChange скрывает создание и удаление', async () => {
    const { user } = setup({ onPromptsChange: undefined }); await user.click(screen.getByLabelText('Настройки'))
    expect(screen.queryByText('Добавить промпт')).not.toBeInTheDocument(); expect(screen.queryByText('Удалить')).not.toBeInTheDocument()
  })

  it('не имеет базовых axe-нарушений в builder и settings', async () => {
    const { user, container } = setup()
    expect((await axe.run(container)).violations).toEqual([])
    await user.click(screen.getByLabelText('Настройки'))
    expect((await axe.run(container)).violations).toEqual([])
  })
  it('Esc при сборке запрашивает подтверждение', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true); const onClose = vi.fn(); const { user } = setup({ onClose }); await generateReady(user)
    await user.click(within(screen.getByText('Первый вариант').closest('article')!).getByText('Добавить')); fireEvent.keyDown(window, { key: 'Escape' })
    expect(confirm).toHaveBeenCalledWith('Отменить сборку?'); expect(onClose).toHaveBeenCalled(); confirm.mockRestore()
  })
})
