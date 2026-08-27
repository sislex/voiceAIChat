// Заметки проекта и режим ассистента (roadmap-4 пп.6–7): что модель должна помнить между ходами
// и с каким приоритетом работать. Хранится сервером в `.make/`, попадает в контекст каждого хода.
import { useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeAssistantMode, MakeProjectNotes } from '@shared/make'
import { Button, Dialog, useToast } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  api: Pick<RendererApi, 'make:notes' | 'make:setNotes'>
  onClose: () => void
  onSaved?: (next: MakeProjectNotes) => void
}

const MODES: Array<{ id: MakeAssistantMode; title: string; hint: string }> = [
  { id: 'balanced', title: 'Сбалансированно', hint: 'Без уклона: и визуал, и код.' },
  { id: 'designer', title: 'Дизайнер', hint: 'Токены, типографика, отступы, состояния, адаптив; логику не трогать без просьбы.' },
  { id: 'developer', title: 'Разработчик', hint: 'Структура кода, состояние, ошибки, тесты; визуал — минимально и через токены.' }
]

export function MakeNotesDialog({ conversationId, api, onClose, onSaved }: Props): JSX.Element {
  const toast = useToast()
  const [data, setData] = useState<MakeProjectNotes | null>(null)
  const [notes, setNotes] = useState('')
  const [mode, setMode] = useState<MakeAssistantMode>('balanced')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let alive = true
    api['make:notes']({ conversationId }).then((n) => { if (alive) { setData(n); setNotes(n.notes); setMode(n.mode) } }).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
    return () => { alive = false }
  }, [api, conversationId, toast])
  const dirty = data !== null && (notes !== data.notes || mode !== data.mode)
  const save = async (): Promise<void> => {
    setSaving(true)
    try { const next = await api['make:setNotes']({ conversationId, notes, mode }); setData(next); onSaved?.(next); toast.success('Заметки и режим сохранены') } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }
  return (
    <Dialog className="make-dialog" padded title="Память проекта" ariaLabel="Память проекта" size="md" onClose={onClose} testId="make-notes"
      footer={<Button size="sm" variant="primary" disabled={!dirty || saving} loading={saving} onClick={() => void save()}>Сохранить</Button>}>
      <p className="make-ideas-lead">Заметки читает ассистент в начале каждого хода: решения по дизайну, договорённости, что не трогать. Он и сам дописывает сюда через <code>make_remember</code>.</p>
      <fieldset className="make-mode-picker">
        <legend>Режим ассистента</legend>
        {MODES.map((m) => (
          <label key={m.id} className={mode === m.id ? 'make-mode on' : 'make-mode'}>
            <input type="radio" name="make-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
            <span><strong>{m.title}</strong><small>{m.hint}</small></span>
          </label>
        ))}
      </fieldset>
      <textarea className="tin make-notes-text" aria-label="Заметки проекта" rows={8} placeholder={'- палитра: тёплые оттенки, акцент --accent\n- карточки товаров не менять без согласования'} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={data === null} />
    </Dialog>
  )
}
