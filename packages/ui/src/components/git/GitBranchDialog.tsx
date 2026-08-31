// Диалог ветки: переключиться на существующую или создать новую.
//
// На грязном дереве не подставляем «отбросить изменения» ни в каком виде: переключение
// идёт `git checkout` без `-f`, и если git отказывается, человек видит его причину и
// сам решает, что делать. Отбрасывание правок — необратимое действие и живёт отдельно.
import { useMemo, useState } from 'react'
import { Button, Dialog, ErrorState } from '@voicechat/ui-kit'
import type { GitBranchList, GitFileChange } from '@shared/gitWorkspace'
import { isValidGitBranchName } from '@shared/gitWorkspace'

export interface GitBranchDialogProps {
  open: boolean
  branches: GitBranchList | null
  current: string | null
  changes: GitFileChange[]
  busy: boolean
  error: string | null
  onClose: () => void
  onCheckout: (branch: string, confirmDirty: boolean) => void
  onCreate: (name: string) => void
  onRefresh: () => void
}

export function GitBranchDialog(props: GitBranchDialogProps): JSX.Element | null {
  const [mode, setMode] = useState<'switch' | 'create'>('switch')
  const [target, setTarget] = useState('')
  const [name, setName] = useState('')
  const dirty = props.changes.length > 0
  // Удалённую ветку показываем под её локальным именем: переключаться человек хочет
  // на `CHAT-42`, а не на `origin/CHAT-42`, и сервер сам создаст локальную с отслеживанием.
  const options = useMemo(() => {
    const list = props.branches?.branches ?? []
    const locals = new Set(list.filter((branch) => !branch.remote).map((branch) => branch.name))
    const remoteOnly = list
      .filter((branch) => branch.remote)
      .map((branch) => branch.name.replace(/^origin\//, ''))
      .filter((branch) => branch && !locals.has(branch))
    return [
      ...list.filter((branch) => !branch.remote).map((branch) => ({ value: branch.name, label: branch.name, hint: branch.name === props.current ? 'текущая' : '' })),
      ...remoteOnly.map((branch) => ({ value: branch, label: branch, hint: 'только в origin' }))
    ]
  }, [props.branches, props.current])

  if (!props.open) return null
  const chosen = target || options.find((option) => option.value !== props.current)?.value || ''
  const nameOk = isValidGitBranchName(name.trim())

  return (
    <Dialog
      onClose={props.onClose}
      title="Ветка рабочей копии"
      testId="git-branch-dialog"
      size="md"
      actions={<Button size="sm" variant="ghost" onClick={props.onRefresh} loading={props.busy}>Обновить из origin</Button>}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>Отмена</Button>
          {mode === 'switch'
            ? <Button variant="primary" loading={props.busy} disabled={!chosen} onClick={() => props.onCheckout(chosen, dirty)}>Переключиться</Button>
            : <Button variant="primary" loading={props.busy} disabled={!nameOk} onClick={() => props.onCreate(name.trim())}>Создать и перейти</Button>}
        </>
      }
    >
      <div className="gitpane-dialog">
        <div className="sideswitch" role="tablist" aria-label="Что сделать с веткой">
          <button type="button" role="tab" aria-selected={mode === 'switch'} className={mode === 'switch' ? 'on' : ''} onClick={() => setMode('switch')}>Переключиться</button>
          <button type="button" role="tab" aria-selected={mode === 'create'} className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>Создать новую</button>
        </div>

        {dirty && (
          <p className="gitpane-dialog-note" role="status">
            В рабочей копии {props.changes.length} незакоммиченных изменений. Git перенесёт их на другую ветку,
            а если это невозможно — откажется переключаться и объяснит, почему. Ничего не потеряется.
          </p>
        )}

        {mode === 'switch' ? (
          <label className="gitpane-field">
            <span>Ветка</span>
            <select aria-label="Ветка для переключения" value={chosen} onChange={(event) => setTarget(event.target.value)}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}{option.hint ? ` — ${option.hint}` : ''}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="gitpane-field">
            <span>Имя новой ветки</span>
            <input
              aria-label="Имя новой ветки"
              value={name}
              placeholder="CHAT-42-fix"
              onChange={(event) => setName(event.target.value)}
            />
            {name.trim() && !nameOk && (
              <span className="gitpane-field-error" role="alert">
                Допустимы латиница, цифры, точка, дефис, подчёркивание и слэш; без «..» и ведущего дефиса.
              </span>
            )}
          </label>
        )}

        {props.error && <ErrorState compact message="Git отказался выполнить операцию" detail={props.error} />}
      </div>
    </Dialog>
  )
}
