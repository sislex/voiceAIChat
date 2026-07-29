import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import type { ModifierPrompt } from '@shared/types'
import { PromptBuilder, type GenerateParams, type Suggestion } from './PromptBuilder'
import { applyNativeInputValue, useAiAssist } from './useAiAssist'

const prompts: ModifierPrompt[] = [
  { id: 'clear', title: 'Ясно и конкретно', text: 'Сделай формулировку ясной и однозначной.', enabled: true, readonly: true },
  { id: 'short', title: 'Кратко', text: 'Убери повторы и лишние слова.', enabled: true },
  { id: 'tone', title: 'Официальный тон', text: 'Используй спокойный официальный тон.', enabled: false }
]
const ready: Suggestion[] = [
  { id: '1', text: 'Подготовь краткое описание продукта с его ключевыми преимуществами.' },
  { id: '2', text: 'Сформулируй убедительное описание продукта и добавь призыв к действию.' },
  { id: '3', text: 'Опиши продукт официальным тоном, выделив пользу для клиента.' }
]
const generate = fn(async (_params: GenerateParams) => ready)

function Demo({ generator = generate, initialPrompts = prompts, writable = true, maxBlocks, dark = false }: { generator?: (p: GenerateParams) => Promise<Suggestion[]>; initialPrompts?: ModifierPrompt[]; writable?: boolean; maxBlocks?: number; dark?: boolean }): JSX.Element {
  const [list, setList] = useState(initialPrompts)
  return <div data-theme={dark ? 'dark' : 'light'} style={{ minHeight: 760, background: dark ? '#111827' : '#eef1f7' }}><PromptBuilder open prompts={list} onPromptsChange={writable ? setList : undefined} generate={generator} onApply={fn()} onClose={fn()} debounceMs={50} maxBlocks={maxBlocks}/></div>
}

async function enter(canvasElement: HTMLElement, value = 'описание продукта') {
  const canvas = within(canvasElement); await userEvent.type(canvas.getByLabelText('Что нужно сформулировать'), value); await userEvent.click(canvas.getByRole('button', { name: 'Предложить варианты' })); await canvas.findByText(ready[0].text); return canvas
}
async function addBlocks(canvasElement: HTMLElement, count = 2) {
  const canvas = await enter(canvasElement); const add = await canvas.findAllByText('Добавить'); for (let i = 0; i < count; i++) await userEvent.click(add[i]); return canvas
}
async function settings(canvasElement: HTMLElement) { const canvas = within(canvasElement); await userEvent.click(canvas.getByLabelText('Настройки')); await expect(canvas.getByRole('dialog')).toHaveAccessibleName('Настройки подсказок') }

const meta: Meta = { title: 'AI Assist/PromptBuilder', parameters: { layout: 'fullscreen' }, render: () => <Demo/> }
export default meta
type Story = StoryObj
export const Default: Story = {}
export const Loading: Story = { render: () => <Demo generator={() => new Promise(() => {})}/>, play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByLabelText('Что нужно сформулировать'), 'текст'); await userEvent.click(within(canvasElement).getByRole('button', { name: 'Предложить варианты' })); await expect(await within(canvasElement).findByText('Генерирую варианты…')).toBeInTheDocument() } }
export const SuggestionsReady: Story = { play: async ({ canvasElement }) => { await enter(canvasElement) } }
export const EmptyResult: Story = { render: () => <Demo generator={async () => []}/>, play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByLabelText('Что нужно сформулировать'), 'текст'); await userEvent.click(within(canvasElement).getByRole('button', { name: 'Предложить варианты' })); await expect(await within(canvasElement).findByText('Вариантов нет')).toBeInTheDocument() } }
export const Error: Story = { render: () => <Demo generator={async () => { throw new globalThis.Error('mock') }}/>, play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByLabelText('Что нужно сформулировать'), 'текст'); await userEvent.click(within(canvasElement).getByRole('button', { name: 'Предложить варианты' })); await expect(await within(canvasElement).findByText('Не удалось получить варианты')).toBeInTheDocument() } }
export const WithBlocks: Story = { play: async ({ canvasElement }) => { await addBlocks(canvasElement, 2) } }
export const WithPreview: Story = WithBlocks
export const MaxBlocksReached: Story = { render: () => <Demo maxBlocks={1}/>, play: async ({ canvasElement }) => { const c = await addBlocks(canvasElement, 1); expect(c.getAllByText('Добавить')[1]).toBeDisabled() } }
export const LongContent: Story = { render: () => <Demo generator={async () => [{ id: 'long', text: 'Очень длинный текст. '.repeat(80) }]}/>, play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByLabelText('Что нужно сформулировать'), 'длинный текст'); await userEvent.click(within(canvasElement).getByRole('button', { name: 'Предложить варианты' })) } }
export const DarkTheme: Story = { render: () => <Demo dark/> }
export const SettingsEmpty: Story = { render: () => <Demo initialPrompts={[]}/>, play: async ({ canvasElement }) => { await settings(canvasElement) } }
export const SettingsWithPrompts: Story = { play: async ({ canvasElement }) => { await settings(canvasElement) } }
export const SettingsEditing: Story = { play: async ({ canvasElement }) => { await settings(canvasElement); await userEvent.click(within(canvasElement).getAllByText('Изменить')[0]) } }
export const SettingsWithReadonlyPrompts: Story = { play: async ({ canvasElement }) => { await settings(canvasElement); const row = within(canvasElement).getByText('Ясно и конкретно').closest('article')!; expect(within(row).queryByText('Удалить')).not.toBeInTheDocument() } }
export const SettingsWithoutOnPromptsChange: Story = { render: () => <Demo writable={false}/>, play: async ({ canvasElement }) => { await settings(canvasElement); expect(within(canvasElement).queryByText('Добавить промпт')).not.toBeInTheDocument() } }

function FieldDemo({ textarea = false, prompts: fieldPrompts = prompts, label = 'Сообщение' }: { textarea?: boolean; prompts?: ModifierPrompt[]; label?: string }): JSX.Element {
  const [value, setValue] = useState(''); const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const ai = useAiAssist({ value, onChange: (text) => ref.current && applyNativeInputValue(ref.current, text), prompts: fieldPrompts, generate })
  const field = textarea ? <textarea ref={ref} data-ai-assist value={value} aria-label={label} onChange={(e) => setValue(e.target.value)}/> : <input ref={ref} data-ai-assist value={value} aria-label={label} onChange={(e) => setValue(e.target.value)}/>
  return <div style={{ padding: 80 }}><div className="ai-assist-wrap">{field}<button className="ai-assist-trigger" {...ai.triggerProps}>🪄</button></div><PromptBuilder {...ai.popupProps} debounceMs={50}/></div>
}
export const InsideInput: Story = { render: () => <FieldDemo/> }
export const InsideTextarea: Story = { render: () => <FieldDemo textarea/> }
export const TwoFieldsWithDifferentPrompts: Story = { render: () => <><FieldDemo label="Название" prompts={[prompts[0]]}/><FieldDemo textarea label="Описание" prompts={[prompts[1], prompts[2]]}/></> }
