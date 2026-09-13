import { useState } from 'react'
import { listCommands } from '@voicechat/ui-foundation/runtime'
import { formatCombo, parseCombo, comboMatches } from '../lib/hotkeys'
import { usePreference } from '../lib/shellPreferences'

export const DEFAULT_SHORTCUTS = { palette: 'mod+k', newChat: 'mod+n', send: 'Enter' }
export type Shortcuts = typeof DEFAULT_SHORTCUTS
export type ShortcutAction = keyof Shortcuts
export const SHORTCUT_IDS = { palette: 'app.palette', newChat: 'app.new-chat', send: 'app.send' }
const labels: Record<ShortcutAction, string> = { palette: 'Палитра команд', newChat: 'Новая беседа', send: 'Отправка сообщения' }
const valid = (value: unknown): value is Shortcuts => !!value && typeof value === 'object' && Object.keys(DEFAULT_SHORTCUTS).every(key => typeof (value as Record<string, unknown>)[key] === 'string')
export const useShortcuts = (user: string): [Shortcuts, (value: Shortcuts) => void] => usePreference(user, 'shortcuts', DEFAULT_SHORTCUTS, valid)
export function shortcutsOverlap(left: string, right: string): boolean {
  const a = parseCombo(left), b = parseCombo(right)
  if (a.key !== b.key) return false
  for (let flags = 0; flags < 16; flags++) {
    const event = { key: a.key, code: a.key, ctrlKey: !!(flags & 1), metaKey: !!(flags & 2), altKey: !!(flags & 4), shiftKey: !!(flags & 8) } as KeyboardEvent
    if (comboMatches(event, a) && comboMatches(event, b)) return true
  }
  return false
}
export function shortcutError(action: ShortcutAction, combo: string, values: Shortcuts): string | null {
  const parsed = parseCombo(combo)
  if (!parsed.key || ['space', 'escape', 'esc', '?'].includes(parsed.key)) return 'Сочетание занято голосовым управлением или шпаргалкой'
  if (!parsed.mod && !parsed.ctrl && !parsed.meta && !parsed.alt && !(action === 'send' && parsed.key === 'enter' && !parsed.shift)) return 'Используйте Ctrl, ⌘ или Alt, чтобы не мешать вводу текста'
  for (const other of Object.keys(values) as ShortcutAction[]) if (other !== action && shortcutsOverlap(combo, values[other])) return `Конфликт: ${labels[other]}`
  for (const command of listCommands()) {
    if (Object.values(SHORTCUT_IDS).includes(command.id) || !command.hotkey) continue
    if (shortcutsOverlap(combo, command.hotkey)) return `Конфликт: ${command.title}`
  }
  return null
}
export function ShortcutSettings({ userId }: { userId: string }): JSX.Element {
  const [values, save] = useShortcuts(userId)
  const [error, setError] = useState<string | null>(null)
  return <fieldset className="shortcut-settings"><legend>Горячие клавиши</legend>
    {(Object.keys(DEFAULT_SHORTCUTS) as ShortcutAction[]).map(action => <label key={action}>{labels[action]}
      <input aria-label={labels[action]} readOnly value={formatCombo(values[action])} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.repeat || ['Control', 'Meta', 'Alt', 'Shift', 'Tab', 'Escape'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const combo = [event.metaKey || event.ctrlKey ? 'mod' : '', event.altKey ? 'alt' : '', event.shiftKey ? 'shift' : '', event.key].filter(Boolean).join('+')
        const issue = shortcutError(action, combo, values)
        setError(issue)
        if (!issue) save({ ...values, [action]: combo })
      }} />
    </label>)}
    <p>Выберите поле и нажмите сочетание.</p>{error && <p role="alert">{error}</p>}
  </fieldset>
}
