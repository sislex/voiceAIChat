// Командная палитра (⌘K / Ctrl+K): одно поле ввода, нечёткий поиск по реестру
// команд (lib/commands.ts) и выполнение с клавиатуры. Всё, что до неё было
// доступно только мышью — переключение бесед и проектов, доска, настройки,
// консоль машины, поиск задачи по номеру — теперь достаётся с клавиатуры.
//
// Окно — общий Dialog: портал, ловушка фокуса, Esc и возврат фокуса на
// открывашку достаются бесплатно и ведут себя как во всех остальных окнах.
//
// Выдача ограничена по пунктам в разделе (`limitPerSection`), а не виртуализована:
// список из сотен бесед сужается запросом, а без запроса показывать сотню строк
// всё равно бессмысленно — сколько скрыто, написано под группой.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  rememberCommand,
  recentCommandIds,
  searchCommands,
  type Command,
  type CommandGroup,
  type CommandHit
} from '../lib/commands'
import { formatCombo } from '../lib/hotkeys'
import { useCommandRegistry } from '../lib/useCommands'
import { Dialog } from './ui/Dialog'
import { EmptyState } from './ui/EmptyState'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** Команды; по умолчанию — общий реестр (в тестах и сториз инжектится список). */
  commands?: Command[]
  /** Сколько пунктов показывать в разделе. */
  limitPerSection?: number
  /** Подписи комбинаций как на macOS; по умолчанию — по платформе. */
  apple?: boolean
}

/** Название с подсвеченными буквами совпадения. */
function Highlighted({ text, indices }: { text: string; indices: number[] }): JSX.Element {
  if (!indices.length) return <>{text}</>
  const marked = new Set(indices)
  const runs: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i += 1) {
    const hit = marked.has(i)
    const last = runs[runs.length - 1]
    if (last && last.hit === hit) last.text += text[i]
    else runs.push({ text: text[i]!, hit })
  }
  return (
    <>
      {runs.map((run, i) =>
        run.hit ? (
          <mark className="cmdk-hit" key={i}>
            {run.text}
          </mark>
        ) : (
          <span key={i}>{run.text}</span>
        )
      )}
    </>
  )
}

export function CommandPalette({
  open,
  onClose,
  commands,
  limitPerSection,
  apple
}: CommandPaletteProps): JSX.Element | null {
  // Реестр читаем только при открытом окне: сборка списка из сотен бесед на
  // каждый рендер приложения не нужна никому.
  const registry = useCommandRegistry(open && commands == null)
  const available = commands ?? registry
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const baseId = useId()

  // Открытие — с чистого листа: запрос из прошлого раза сбивает с толку, а
  // «недавние» с прошлого открытия могли устареть.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    setRecent(recentCommandIds())
  }, [open])

  const groups: CommandGroup[] = useMemo(
    () =>
      open
        ? searchCommands(available, query, {
            ...(limitPerSection != null ? { limitPerSection } : {}),
            recent
          })
        : [],
    [open, available, query, limitPerSection, recent]
  )
  const flat = useMemo(() => groups.flatMap((group) => group.hits), [groups])
  const index = flat.length ? Math.min(active, flat.length - 1) : 0
  const activeId = flat.length ? `${baseId}-item-${index}` : undefined

  // Выбранный пункт держим в видимой части списка: со стрелками легко уехать
  // за край, а прокрутка мышью — не то, чем должна заниматься клавиатура.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [index, groups])

  if (!open) return null

  const run = (hit: CommandHit): void => {
    rememberCommand(hit.command.id)
    // Сначала закрываем: команда может открыть своё окно, и палитра не должна
    // остаться слоем под ним.
    onClose()
    hit.command.run()
  }

  const step = (delta: number): void => {
    if (!flat.length) return
    setActive((prev) => {
      const from = Math.min(prev, flat.length - 1)
      return (from + delta + flat.length) % flat.length
    })
  }

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      step(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(Math.max(flat.length - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const hit = flat[index]
      if (hit) run(hit)
    }
  }

  let cursor = -1
  const footer: ReactNode = (
    <p className="cmdk-foot">
      <kbd>↑</kbd> <kbd>↓</kbd> — выбор · <kbd>Enter</kbd> — выполнить · <kbd>Esc</kbd> — закрыть
    </p>
  )

  return (
    <Dialog
      title="Команды"
      ariaLabel="Командная палитра"
      size="md"
      className="cmdk"
      testId="command-palette"
      initialFocusRef={inputRef}
      onClose={onClose}
      footer={footer}
    >
      <div className="cmdk-body">
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={`${baseId}-list`}
          aria-autocomplete="list"
          {...(activeId ? { 'aria-activedescendant': activeId } : {})}
          aria-label="Поиск команды, беседы, проекта или задачи"
          placeholder="Команда, беседа, проект, #номер задачи…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onInputKeyDown}
        />
        <div className="cmdk-list" id={`${baseId}-list`} role="listbox" aria-label="Команды" ref={listRef}>
          {groups.length === 0 && (
            <EmptyState
              compact
              icon="🔍"
              title="Ничего не найдено"
              description="Попробуйте короче: палитра ищет по буквам подряд, но с пропусками."
            />
          )}
          {groups.map((group) => (
            <div className="cmdk-group" key={group.key} role="group" aria-labelledby={`${baseId}-${group.key}`}>
              <p className="cmdk-sec" id={`${baseId}-${group.key}`}>
                {group.title}
              </p>
              {group.hits.map((hit) => {
                cursor += 1
                const at = cursor
                const isActive = at === index
                return (
                  <div
                    key={hit.command.id}
                    id={`${baseId}-item-${at}`}
                    className={isActive ? 'cmdk-item cmdk-item--active' : 'cmdk-item'}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive ? 'true' : 'false'}
                    // Мышь работает наравне с клавиатурой: наведение переносит
                    // выбор, чтобы Enter выполнил то, на что смотрит курсор.
                    onMouseMove={() => setActive(at)}
                    onClick={() => run(hit)}
                  >
                    <span className="cmdk-title">
                      <Highlighted text={hit.command.title} indices={hit.indices} />
                    </span>
                    {hit.command.hint && <span className="cmdk-hint">{hit.command.hint}</span>}
                    {hit.command.hotkey && (
                      <kbd className="cmdk-key">{formatCombo(hit.command.hotkey, apple)}</kbd>
                    )}
                  </div>
                )
              })}
              {group.hidden > 0 && (
                <p className="cmdk-more">
                  …и ещё {group.hidden} — уточните запрос
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
