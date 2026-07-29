import { useRef, useState, type ButtonHTMLAttributes, type RefObject } from 'react'
import type { ModifierPrompt } from '@shared/types'
import type { PromptBuilderProps } from './PromptBuilder'

export interface UseAiAssistOptions {
  value: string
  onChange: (value: string) => void
  prompts: ModifierPrompt[]
  onPromptsChange?: (next: ModifierPrompt[]) => void
  generate: PromptBuilderProps['generate']
}

export function useAiAssist({ value, onChange, prompts, onPromptsChange, generate }: UseAiAssistOptions): {
  triggerProps: ButtonHTMLAttributes<HTMLButtonElement> & { ref: RefObject<HTMLButtonElement> }
  popupProps: PromptBuilderProps
} {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = (): void => { setOpen(false); queueMicrotask(() => triggerRef.current?.focus()) }
  return {
    triggerProps: { ref: triggerRef, type: 'button', 'aria-label': 'Открыть AI-помощник', title: 'AI-помощник', 'aria-expanded': open, onClick: () => setOpen(true) },
    popupProps: { open, initialValue: value, prompts, onPromptsChange, generate, onApply: onChange, onClose: close }
  }
}

/** Записывает значение в нативное поле и посылает bubbling input-event для библиотек форм. */
export function applyNativeInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
