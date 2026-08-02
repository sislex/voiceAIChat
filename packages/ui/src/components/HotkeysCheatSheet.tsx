// Шпаргалка горячих клавиш по «?». До неё нигде не было написано, какие клавиши
// вообще существуют: про push-to-talk пользователь узнавал случайно.
//
// Список генерируется из того же реестра, что и палитра (lib/commands.ts):
// команда объявляет `hotkey`, и она сама появляется в шпаргалке. Второй список
// «для документации» неизбежно разъехался бы с настоящими биндингами.
//
// Выключенные команды тут показываются: шпаргалка — документация, а не список
// применимого сейчас (иначе «удерживайте пробел» пропадал бы во время записи —
// ровно тогда, когда подсказка и нужна).

import { COMMAND_SECTIONS, SECTION_TITLES, type Command, type CommandSection } from '../lib/commands'
import { formatCombo, isApplePlatform } from '../lib/hotkeys'
import { useCommandRegistry } from '../lib/useCommands'
import { Dialog } from './ui/Dialog'
import { EmptyState } from './ui/EmptyState'

export interface HotkeysCheatSheetProps {
  open: boolean
  onClose: () => void
  /** Команды; по умолчанию — общий реестр. */
  commands?: Command[]
  /** Раскладка подписей: ⌘ (macOS) или Ctrl. По умолчанию — по платформе. */
  apple?: boolean
}

export function HotkeysCheatSheet({ open, onClose, commands, apple }: HotkeysCheatSheetProps): JSX.Element | null {
  const registry = useCommandRegistry(open && commands == null)
  const all = commands ?? registry
  if (!open) return null

  const mac = apple ?? isApplePlatform()
  const withKeys = all.filter((command) => command.hotkey)
  const sections: { section: CommandSection; items: Command[] }[] = COMMAND_SECTIONS.map((section) => ({
    section,
    items: withKeys.filter((command) => command.section === section)
  })).filter((group) => group.items.length > 0)

  return (
    <Dialog title="Горячие клавиши" size="sm" className="hkeys" testId="hotkeys-sheet" onClose={onClose}>
      <div className="mdbody">
        {sections.length === 0 && (
          <EmptyState compact icon="⌨" title="Горячих клавиш пока нет" description="Команды объявляют их сами." />
        )}
        {sections.map((group) => (
          <div className="hkeys-group" key={group.section}>
            <p className="hkeys-sec">{SECTION_TITLES[group.section]}</p>
            <ul className="hkeys-list">
              {group.items.map((command) => (
                <li className="hkeys-row" key={command.id}>
                  <span className="hkeys-name">{command.title}</span>
                  <span className="hkeys-combo">
                    <kbd>{formatCombo(command.hotkey ?? '', mac)}</kbd>
                    {command.hotkeyNote && <span className="hkeys-note">{command.hotkeyNote}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="hkeys-tail">
          Клавиши без модификатора (пробел, Esc, <kbd>?</kbd>) не срабатывают, когда курсор в поле ввода, —
          там они печатаются. {mac ? '⌘' : 'Ctrl'}K работает всегда.
        </p>
      </div>
    </Dialog>
  )
}
