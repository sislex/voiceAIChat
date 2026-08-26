import { useState } from 'react'
import { Button, IconButton, useConfirm } from '@voicechat/ui-kit'
import type { ChatInstruction } from '@shared/types'
import { instructionText, missingBuiltinInstructions, standardInstructionText } from '@shared/chatInstructions'

export interface ChatInstructionsSettingsProps {
  items: ChatInstruction[]
  onChange: (items: ChatInstruction[]) => void
}

/** Уникальный id для новой/скопированной инструкции (человекочитаемый префикс + случайный хвост). */
function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${rand}`
}

/**
 * Раздел «Инструкции» настроек: список с чекбоксами и редактор одной инструкции.
 * Встроенные (с `kind`) правятся по тексту — правка хранится в `text`, «Сбросить»
 * возвращает стандарт; копия встроенной теряет `kind` и становится своей (у неё нет
 * ответного блока, это просто текст для модели). Удалённую встроенную можно вернуть
 * кнопкой «Восстановить стандартные».
 */
export function ChatInstructionsSettings({ items, onChange }: ChatInstructionsSettingsProps): JSX.Element {
  const confirm = useConfirm()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ChatInstruction | null>(null)
  const missing = missingBuiltinInstructions(items)

  const startEdit = (item: ChatInstruction): void => {
    setEditingId(item.id)
    setDraft({ ...item, text: instructionText(item) })
  }
  const add = (): void => {
    const item: ChatInstruction = { id: newId('custom'), title: 'Новая инструкция', description: '', enabled: true, text: '' }
    onChange([...items, item])
    startEdit(item)
  }
  const duplicate = (item: ChatInstruction): void => {
    const copy: ChatInstruction = { id: newId('copy'), title: `${item.title} (копия)`, description: item.description, enabled: item.enabled, text: instructionText(item) }
    const at = items.findIndex((it) => it.id === item.id)
    onChange([...items.slice(0, at + 1), copy, ...items.slice(at + 1)])
    startEdit(copy)
  }
  const remove = (item: ChatInstruction): void => {
    void confirm({ title: `Удалить инструкцию «${item.title}»?`, message: item.kind ? 'Встроенную можно вернуть кнопкой «Восстановить стандартные».' : undefined, variant: 'danger', confirmLabel: 'Удалить' })
      .then((ok) => {
        if (!ok) return
        onChange(items.filter((it) => it.id !== item.id))
        if (editingId === item.id) { setEditingId(null); setDraft(null) }
      })
  }
  const save = (): void => {
    if (!draft) return
    // Для встроенной пустой или стандартный текст означает «без правки» — не храним копию стандарта.
    const standard = draft.kind ? standardInstructionText(draft.kind) : ''
    const text = draft.text?.trim() ?? ''
    const next: ChatInstruction = { ...draft, title: draft.title.trim() || 'Без названия', description: draft.description.trim() }
    if (!draft.kind || (text && text !== standard)) next.text = text
    else delete next.text
    onChange(items.map((it) => (it.id === next.id ? next : it)))
    setEditingId(null); setDraft(null)
  }

  return (
    <>
      <p className="fsub">
        Тексты, которые модель получает с каждым сообщением. Снятая галочка — модель не знает, как выполнить
        такую просьбу: например, без «Открывать терминал» на «открой консоль» она ответит текстом.
        Для одного разговора инструкции выключаются в его настройках → «Контекст и инструкции».
      </p>
      <ul className="instr-list" aria-label="Инструкции чата">
        {items.map((item) => (
          <li className="instr-item" key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={item.enabled}
                aria-label={item.title}
                onChange={(e) => onChange(items.map((it) => (it.id === item.id ? { ...it, enabled: e.target.checked } : it)))}
              />
              <span>
                <p className="flab">{item.title}{item.kind && item.text && <span className="instr-badge" title="Стандартный текст изменён">изменена</span>}{!item.kind && <span className="instr-badge">своя</span>}</p>
                <p className="fsub">{item.description}</p>
              </span>
            </label>
            <span className="instr-actions">
              <IconButton size="sm" aria-label={`Изменить: ${item.title}`} title="Изменить" onClick={() => startEdit(item)}>✏️</IconButton>
              <IconButton size="sm" aria-label={`Дублировать: ${item.title}`} title="Дублировать" onClick={() => duplicate(item)}>⧉</IconButton>
              <IconButton size="sm" aria-label={`Удалить: ${item.title}`} title="Удалить" onClick={() => remove(item)}>✕</IconButton>
            </span>
            {editingId === item.id && draft && (
              <form className="instr-editor" data-testid="instruction-editor" onSubmit={(e) => { e.preventDefault(); save() }}>
                <label className="instr-field"><span>Название</span><input className="tin" value={draft.title} aria-label="Название инструкции" onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
                <label className="instr-field"><span>Описание</span><input className="tin" value={draft.description} aria-label="Описание инструкции" onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
                <label className="instr-field"><span>Текст для модели</span><textarea className="tin instr-text" rows={8} value={draft.text ?? ''} aria-label="Текст инструкции" onChange={(e) => setDraft({ ...draft, text: e.target.value })} /></label>
                {draft.kind && (
                  <p className="fsub">Встроенная инструкция вида <code>{draft.kind}</code>: её ответный блок распознаётся и вырезается по настройке независимо от текста.</p>
                )}
                <div className="instr-editor-actions">
                  <Button size="sm" type="submit">Сохранить</Button>
                  <Button size="sm" variant="secondary" type="button" onClick={() => { setEditingId(null); setDraft(null) }}>Отмена</Button>
                  {draft.kind && draft.text !== standardInstructionText(draft.kind) && (
                    <Button size="sm" variant="ghost" type="button" onClick={() => setDraft({ ...draft, text: standardInstructionText(draft.kind!) })}>Сбросить к стандартному</Button>
                  )}
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
      <div className="instr-footer">
        <Button size="sm" variant="secondary" type="button" onClick={add}>+ Добавить инструкцию</Button>
        {missing.length > 0 && (
          <Button size="sm" variant="ghost" type="button" title={missing.map((it) => it.title).join(', ')} onClick={() => onChange([...items, ...missing])}>
            Восстановить стандартные ({missing.length})
          </Button>
        )}
      </div>
    </>
  )
}
