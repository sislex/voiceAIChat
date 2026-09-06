// Заметки проекта и режим ассистента (roadmap-4 пп.6–7): что модель должна помнить между ходами
// и с каким приоритетом работать. Хранится сервером в `.make/`, попадает в контекст каждого хода.
import { useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeAssistantMode, MakeProjectNotes, MakeStack, MakeUiKit } from '@shared/make'
import { Button, Dialog, useToast } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  api: Pick<RendererApi, 'make:notes' | 'make:setNotes' | 'make:template'>
  onClose: () => void
  onSaved?: (next: MakeProjectNotes) => void
}

type StackChoice = 'react' | 'angular' | 'bootstrap' | 'html-js' | 'html'

const STACK_CHOICES: Array<{ id: StackChoice; title: string; stack: MakeStack; uiKit: MakeUiKit }> = [
  { id: 'react', title: 'React', stack: 'react', uiKit: 'none' },
  { id: 'angular', title: 'Angular', stack: 'angular', uiKit: 'none' },
  { id: 'bootstrap', title: 'Bootstrap', stack: 'html-js', uiKit: 'bootstrap' },
  { id: 'html-js', title: 'Чистый HTML + CSS + JS', stack: 'html-js', uiKit: 'none' },
  { id: 'html', title: 'Чистый HTML + CSS', stack: 'html', uiKit: 'none' }
]

function stackChoice(stack: MakeStack, uiKit: MakeUiKit): StackChoice {
  if (stack === 'html-js' && uiKit === 'bootstrap') return 'bootstrap'
  return stack
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
  const [choice, setChoice] = useState<StackChoice>('html-js')
  const [saving, setSaving] = useState(false)
  const [confirmStack, setConfirmStack] = useState(false)
  useEffect(() => {
    let alive = true
    api['make:notes']({ conversationId }).then((n) => { if (alive) { setData(n); setNotes(n.notes); setMode(n.mode); setChoice(stackChoice(n.stack, n.uiKit)) } }).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
    return () => { alive = false }
  }, [api, conversationId, toast])
  const selected = STACK_CHOICES.find((item) => item.id === choice)!
  const dirty = data !== null && (notes !== data.notes || mode !== data.mode || choice !== stackChoice(data.stack, data.uiKit))
  const persist = async (applyTemplate: boolean): Promise<void> => {
    setSaving(true)
    try {
      const next = await api['make:setNotes']({ conversationId, notes, mode, stack: selected.stack, uiKit: selected.uiKit })
      if (applyTemplate) await api['make:template']({ conversationId, templateId: selected.stack === 'html-js' ? 'blank' : selected.stack })
      setData(next); onSaved?.(next); setConfirmStack(false); toast.success('Настройки проекта сохранены')
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }
  const save = (): void => {
    if (data && selected.stack !== data.stack) setConfirmStack(true)
    else void persist(false)
  }
  return (
    <>
    <Dialog className="make-dialog" padded title="Настройки проекта" ariaLabel="Настройки проекта" size="md" onClose={onClose} testId="make-notes"
      footer={<Button size="sm" variant="primary" disabled={!dirty || saving} loading={saving} onClick={save}>Сохранить</Button>}>
      <p className="make-ideas-lead">Заметки читает ассистент в начале каждого хода: решения по дизайну, договорённости, что не трогать. Он и сам дописывает сюда через <code>make_remember</code>.</p>
      <label className="make-field">
        <span>Стек интерфейса</span>
        <select className="tin" aria-label="Стек интерфейса" value={choice} onChange={(event) => setChoice(event.target.value as StackChoice)} disabled={data === null || saving}>
          {STACK_CHOICES.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
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
    {confirmStack && <Dialog className="make-dialog" padded title="Сменить стек проекта?" ariaLabel="Смена стека" size="sm" onClose={() => setConfirmStack(false)} testId="make-stack-confirm"
      footer={<><Button size="sm" variant="secondary" onClick={() => void persist(false)}>Только настройка</Button><Button size="sm" variant="primary" onClick={() => void persist(true)}>Настройка + применить шаблон</Button></>}>
      <p>Файлы проекта будут заменены только при применении стартового шаблона. Перед заменой сервер создаст снимок «До смены стека».</p>
    </Dialog>}
    </>
  )
}
