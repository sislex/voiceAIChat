import { useEffect, useRef, useState } from 'react'
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
  // Тема — на <html>: окно уходит порталом в document.body, вне этой обёртки (как в App).
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  return <div data-theme={dark ? 'dark' : 'light'} style={{ minHeight: 760, background: dark ? '#111827' : '#eef1f7' }}><PromptBuilder open prompts={list} onPromptsChange={writable ? setList : undefined} generate={generator} onApply={fn()} onClose={fn()} debounceMs={50} maxBlocks={maxBlocks}/></div>
}

/** Окно рендерится порталом в document.body, поэтому canvasElement его не содержит. */
const canvas = () => within(document.body)

async function enter(value = 'описание продукта') {
  const c = canvas(); await userEvent.type(c.getByLabelText('Что нужно сформулировать'), value); await userEvent.click(c.getByRole('button', { name: 'Предложить варианты' })); await c.findByText(ready[0].text); return c
}
async function addBlocks(count = 2) {
  const c = await enter(); const add = await c.findAllByText('Добавить'); for (let i = 0; i < count; i++) await userEvent.click(add[i]); return c
}
async function settings() { const c = canvas(); await userEvent.click(c.getByLabelText('Настройки')); await expect(c.getByRole('dialog')).toHaveAccessibleName('Настройки подсказок') }

const meta: Meta = { title: 'AI Assist/PromptBuilder', parameters: { layout: 'fullscreen' }, render: () => <Demo/> }
export default meta
type Story = StoryObj
export const Default: Story = {}
export const Loading: Story = { render: () => <Demo generator={() => new Promise(() => {})}/>, play: async () => { await userEvent.type(canvas().getByLabelText('Что нужно сформулировать'), 'текст'); await userEvent.click(canvas().getByRole('button', { name: 'Предложить варианты' })); await expect(await canvas().findByText('Генерирую варианты…')).toBeInTheDocument() } }
export const SuggestionsReady: Story = { play: async () => { await enter() } }
export const EmptyResult: Story = { render: () => <Demo generator={async () => []}/>, play: async () => { await userEvent.type(canvas().getByLabelText('Что нужно сформулировать'), 'текст'); await userEvent.click(canvas().getByRole('button', { name: 'Предложить варианты' })); await expect(await canvas().findByText('Вариантов нет')).toBeInTheDocument() } }
export const Error: Story = { render: () => <Demo generator={async () => { throw new globalThis.Error('mock') }}/>, play: async () => { await userEvent.type(canvas().getByLabelText('Что нужно сформулировать'), 'текст'); await userEvent.click(canvas().getByRole('button', { name: 'Предложить варианты' })); await expect(await canvas().findByText('Не удалось получить варианты')).toBeInTheDocument() } }
export const WithBlocks: Story = { play: async () => { await addBlocks(2) } }
export const WithPreview: Story = WithBlocks
export const MaxBlocksReached: Story = { render: () => <Demo maxBlocks={1}/>, play: async () => { const c = await addBlocks(1); expect(c.getAllByText('Добавить')[1]).toBeDisabled() } }
export const LongContent: Story = { render: () => <Demo generator={async () => [{ id: 'long', text: 'Очень длинный текст. '.repeat(80) }]}/>, play: async () => { await userEvent.type(canvas().getByLabelText('Что нужно сформулировать'), 'длинный текст'); await userEvent.click(canvas().getByRole('button', { name: 'Предложить варианты' })) } }
export const DarkTheme: Story = { render: () => <Demo dark/> }
export const SettingsEmpty: Story = { render: () => <Demo initialPrompts={[]}/>, play: async () => { await settings() } }
export const SettingsWithPrompts: Story = { play: async () => { await settings() } }
export const SettingsEditing: Story = { play: async () => { await settings(); await userEvent.click(canvas().getAllByText('Изменить')[0]) } }
export const SettingsWithReadonlyPrompts: Story = { play: async () => { await settings(); const row = canvas().getByText('Ясно и конкретно').closest('article')!; expect(within(row).queryByText('Удалить')).not.toBeInTheDocument() } }
export const SettingsWithoutOnPromptsChange: Story = { render: () => <Demo writable={false}/>, play: async () => { await settings(); expect(canvas().queryByText('Добавить промпт')).not.toBeInTheDocument() } }

function FieldDemo({ textarea = false, prompts: fieldPrompts = prompts, label = 'Сообщение' }: { textarea?: boolean; prompts?: ModifierPrompt[]; label?: string }): JSX.Element {
  const [value, setValue] = useState(''); const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const ai = useAiAssist({ value, onChange: (text) => ref.current && applyNativeInputValue(ref.current, text), prompts: fieldPrompts, generate })
  const field = textarea ? <textarea ref={ref} data-ai-assist value={value} aria-label={label} onChange={(e) => setValue(e.target.value)}/> : <input ref={ref} data-ai-assist value={value} aria-label={label} onChange={(e) => setValue(e.target.value)}/>
  return <div style={{ padding: 80 }}><div className="ai-assist-wrap">{field}<button className="ai-assist-trigger" {...ai.triggerProps}>🪄</button></div><PromptBuilder {...ai.popupProps} debounceMs={50}/></div>
}
export const InsideInput: Story = { render: () => <FieldDemo/> }
export const InsideTextarea: Story = { render: () => <FieldDemo textarea/> }
export const TwoFieldsWithDifferentPrompts: Story = { render: () => <><FieldDemo label="Название" prompts={[prompts[0]]}/><FieldDemo textarea label="Описание" prompts={[prompts[1], prompts[2]]}/></> }
