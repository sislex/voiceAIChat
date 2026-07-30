import { useRef, useState } from 'react'
import { screen } from '@testing-library/react'
import { render } from '../../test/uiRender'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PromptBuilder } from './PromptBuilder'
import { applyNativeInputValue, useAiAssist } from './useAiAssist'

function Harness(): JSX.Element {
  const [value, setValue] = useState(''); const input = useRef<HTMLInputElement>(null)
  const ai = useAiAssist({ value, onChange: (next) => input.current && applyNativeInputValue(input.current, next), prompts: [], generate: async () => [{ id: '1', text: 'Готовый текст' }] })
  return <><input ref={input} data-ai-assist value={value} onChange={(e) => setValue(e.target.value)}/><button {...ai.triggerProps}>Палочка</button><PromptBuilder {...ai.popupProps} debounceMs={0}/></>
}
describe('useAiAssist', () => {
  it('применение посылает нативный input-event и возвращает фокус на палочку', async () => {
    const user = userEvent.setup(); render(<Harness/>); await user.click(screen.getByText('Палочка')); await user.type(screen.getByLabelText('Что нужно сформулировать'), 'x'); await user.click(screen.getByRole('button', { name: 'Предложить варианты' })); await screen.findByText('Готовый текст')
    await user.click(screen.getByText('Добавить')); await user.click(screen.getByText('Применить'))
    expect(screen.getByRole('textbox')).toHaveValue('Готовый текст'); await vi.waitFor(() => expect(screen.getByText('Палочка')).toHaveFocus())
  })
})
