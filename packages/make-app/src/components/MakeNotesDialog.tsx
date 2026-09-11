import { Dialog, useToast } from '../i18n/ui'
import { mt, useMakeLocale } from '../i18n'
// Project notes and assistant mode (roadmap-4, items 6-7): persistent guidance and priorities
// across turns. Stored on the server under .make/ and included in each turn's context.
import { useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeAssistantMode, MakeProjectNotes, MakeStack, MakeUiKit } from '@shared/make'
import { Button } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  api: Pick<RendererApi, 'make:notes' | 'make:setNotes' | 'make:template'>
  onClose: () => void
  onSaved?: (next: MakeProjectNotes) => void
}

const STACKS: Array<{ id: MakeStack; title: string }> = [
  { id: 'react', title: 'React' },
  { id: 'angular', title: 'Angular' },
  { id: 'html-js', get title() { return mt("plainHtmlCssJs") } },
  { id: 'html', get title() { return mt("plainHtmlCss") } }
]

const UI_KITS: Array<{ id: MakeUiKit; title: string }> = [
  { id: 'none', get title() { return mt("customDesignSystem") } },
  { id: 'bootstrap', title: 'Bootstrap 5.3' }
]

const MODES: Array<{ id: MakeAssistantMode; title: string; hint: string }> = [
  { id: 'balanced', get title() { return mt("balanced") }, get hint() { return mt("equalFocusOnVisualsAndCode") } },
  { id: 'designer', get title() { return mt("designer") }, get hint() { return mt("tokensTypographySpacingStatesAndResponsiveLayoutsChangeLogic") } },
  { id: 'developer', get title() { return mt("developer") }, get hint() { return mt("codeStructureStateErrorsAndTestsKeepVisualChanges") } }
]

export function MakeNotesDialog({ conversationId, api, onClose, onSaved }: Props): JSX.Element {
  useMakeLocale()
  const toast = useToast()
  const [data, setData] = useState<MakeProjectNotes | null>(null)
  const [notes, setNotes] = useState('')
  const [mode, setMode] = useState<MakeAssistantMode>('balanced')
  const [stack, setStack] = useState<MakeStack>('html-js')
  const [uiKit, setUiKit] = useState<MakeUiKit>('none')
  const [saving, setSaving] = useState(false)
  const [confirmStack, setConfirmStack] = useState(false)
  useEffect(() => {
    let alive = true
    api['make:notes']({ conversationId }).then((n) => { if (alive) { setData(n); setNotes(n.notes); setMode(n.mode); setStack(n.stack); setUiKit(n.uiKit) } }).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
    return () => { alive = false }
  }, [api, conversationId, toast])
  const dirty = data !== null && (notes !== data.notes || mode !== data.mode || stack !== data.stack || uiKit !== data.uiKit)
  const persist = async (applyTemplate: boolean): Promise<void> => {
    setSaving(true)
    try {
      const next = await api['make:setNotes']({ conversationId, notes, mode, stack, uiKit })
      if (applyTemplate) await api['make:template']({ conversationId, templateId: stack === 'html-js' ? 'blank' : stack })
      setData(next); onSaved?.(next); setConfirmStack(false); toast.success(mt("projectSettingsSaved"))
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setSaving(false) }
  }
  const save = (): void => {
    if (data && stack !== data.stack) setConfirmStack(true)
    else void persist(false)
  }
  return (
    <>
    <Dialog className="make-dialog" padded title={mt("projectSettings")} ariaLabel={mt("projectSettings")} size="md" onClose={onClose} testId="make-notes"
      footer={<Button size="sm" variant="primary" disabled={!dirty || saving} loading={saving} onClick={save}>{mt("save")}</Button>}>
      <p className="make-ideas-lead">{mt("theAssistantReadsTheseNotesAtTheStartOf")}{' '}<code>make_remember</code>.</p>
      <label className="make-field">
        <span>{mt("interfaceStack")}</span>
        <select className="tin" aria-label={mt("interfaceStack")} value={stack} onChange={(event) => setStack(event.target.value as MakeStack)} disabled={data === null || saving}>
          {STACKS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      <label className="make-field">
        <span>{mt("styleFoundation")}</span>
        <select className="tin" aria-label={mt("styleFoundation")} value={uiKit} onChange={(event) => setUiKit(event.target.value as MakeUiKit)} disabled={data === null || saving}>
          {UI_KITS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      <fieldset className="make-mode-picker">
        <legend>{mt("assistantMode")}</legend>
        {MODES.map((m) => (
          <label key={m.id} className={mode === m.id ? 'make-mode on' : 'make-mode'}>
            <input type="radio" name="make-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
            <span><strong>{m.title}</strong><small>{m.hint}</small></span>
          </label>
        ))}
      </fieldset>
      <textarea className="tin make-notes-text" aria-label={mt("projectNotes")} rows={8} placeholder={mt("paletteWarmTonesAccentAccentDoNotChangeProduct")} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={data === null} />
    </Dialog>
    {confirmStack && <Dialog className="make-dialog" padded title={mt("changeTheProjectStack")} ariaLabel={mt("changeStack")} size="sm" onClose={() => setConfirmStack(false)} testId="make-stack-confirm"
      footer={<><Button size="sm" variant="secondary" onClick={() => void persist(false)}>{mt("settingsOnly")}</Button><Button size="sm" variant="primary" onClick={() => void persist(true)}>{mt("saveSettingsAndApplyTemplate")}</Button></>}>
      <p>{mt("projectFilesAreReplacedOnlyWhenApplyingTheStarter")}</p>
    </Dialog>}
    </>
  )
}
