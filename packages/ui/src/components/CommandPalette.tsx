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
} from '@voicechat/ui-foundation/runtime'
import { formatCombo } from '../lib/hotkeys'
import { useCommandRegistry } from '@voicechat/ui-foundation/runtime'
import { Dialog } from '@voicechat/ui-kit'
import { EmptyState } from '@voicechat/ui-kit'
import type { RendererApi } from '@shared/ipc'
import { SEARCH_LABELS, searchText } from '@shared/universalSearch'
import { useUniversalSearch } from '../lib/useUniversalSearch'

export interface CommandPaletteProps {
  userId?: string
  api?: RendererApi
  onNavigate?: (href: string) => void
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
  userId,
  onClose,
  commands,
  limitPerSection,
  apple,
  api,
  onNavigate
}: CommandPaletteProps): JSX.Element | null {
  // Реестр читаем только при открытом окне: сборка списка из сотен бесед на
  // каждый рендер приложения не нужна никому.
  const registry = useCommandRegistry(open && commands == null)
  const available = useMemo(() => api
    ? (commands ?? registry).filter(command => command.section === 'action').map(command => ({
      ...command, title: searchText(command.title), hint: searchText(command.hint ?? ''), keywords: (command.keywords ?? []).map(searchText)
    })).filter(command => command.title)
    : commands ?? registry, [api, commands, registry])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const recent = recentCommandIds(userId)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const remote = useUniversalSearch(api, open, userId, query)

  useEffect(() => {
    if (!open) return
    const viewport = window.visualViewport
    const update = (): void => {
      const dialog = inputRef.current?.closest<HTMLElement>('.cmdk')
      dialog?.style.setProperty('--cmdk-height', String(viewport?.height ?? window.innerHeight) + 'px')
      dialog?.style.setProperty('--cmdk-top', String(viewport?.offsetTop ?? 0) + 'px')
      listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [open])

  // Открытие — с чистого листа: запрос из прошлого раза сбивает с толку, а
  // «недавние» с прошлого открытия могли устареть.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
  }, [open, userId])

  const localGroups: CommandGroup[] = useMemo(
    () =>
      open
        ? searchCommands(available, query, {
            ...(limitPerSection != null ? { limitPerSection } : {}),
            recent
          })
        : [],
    [open, available, query, limitPerSection, recent]
  )
  const groups: Array<Omit<CommandGroup, 'key'> & { key: string }> = [
    ...localGroups,
    ...(remote.page?.groups.filter(group => group.hits.length).map(group => ({
      key: 'search-' + group.source,
      title: (query.trim() ? '' : 'Недавние · ') + SEARCH_LABELS[group.source],
      hidden: 0,
      hits: group.hits.map(hit => ({
        indices: [],
        score: 0,
        command: {
          id: '__search:' + hit.id, title: hit.title, hint: hit.snippet, section: 'action' as const,
          run: () => { void remote.select(hit, href => { onClose(); onNavigate?.(href) }) }
        }
      }))
    })) ?? [])
  ]
  const flat = groups.flatMap((group) => group.hits)
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
    if (hit.command.enabled?.() === false) return
    if (hit.command.id.startsWith('__search:')) { hit.command.run(); return }
    rememberCommand(hit.command.id, userId)
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
      title={api ? 'Поиск и команды' : 'Команды'}
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
          placeholder={api ? 'Чаты, сообщения, проекты, задачи, файлы, знания…' : 'Команда, беседа, проект, #номер задачи…'}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onInputKeyDown}
        />
        {remote.loading && <p role="status">Поиск…</p>}
        {remote.error && <p role="alert">{remote.error} <button onClick={remote.retry}>Повторить</button></p>}
        {remote.page?.groups.some(group => group.status === 'unavailable') && <p role="status">{remote.page.groups.every(group => group.status === 'unavailable') ? 'Поиск недоступен' : 'Частичная выдача'}: {remote.page.groups.filter(group => group.status === 'unavailable').map(group => SEARCH_LABELS[group.source]).join(', ')}. <button onClick={remote.retry}>Повторить</button></p>}
        {api && !query.trim() && !remote.loading && !remote.page?.groups.some(group => group.hits.length) && <p role="status">Недавних доступных переходов пока нет.</p>}
          {groups.length === 0 && !remote.loading && !remote.error && (
            <EmptyState
              compact
              icon="🔍"
              title="Ничего не найдено"
              description="Попробуйте изменить запрос."
            />
          )}
        <div className="cmdk-list" id={`${baseId}-list`} role="listbox" aria-label="Команды" ref={listRef}>
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
                    {hit.command.hint && <span className="cmdk-hint"><Highlighted text={hit.command.hint} indices={
                      hit.command.id.startsWith('__search:') && query.trim() && hit.command.hint.toLowerCase().includes(query.trim().toLowerCase())
                        ? Array.from({ length: query.trim().length }, (_, offset) => hit.command.hint!.toLowerCase().indexOf(query.trim().toLowerCase()) + offset)
                        : []
                    } /></span>}
                    {hit.command.hotkey ? (
                      <kbd className="cmdk-key">{formatCombo(hit.command.hotkey, apple)}</kbd>
                    ) : <span className="cmdk-key" aria-label="Сочетание не назначено">—</span>}
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
        {remote.page?.nextCursor && <button disabled={remote.loading} onClick={() => void remote.loadMore()}>Загрузить ещё</button>}
      </div>
    </Dialog>
  )
}
