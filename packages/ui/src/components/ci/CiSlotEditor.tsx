// Упорядоченный мультиселект команд для слота (до/после). Команда может
// повторяться; порядок = порядок выполнения (перестановка ▲▼, удаление ✕).
// Стиль — токены темы, без хардкода цветов.
import { useEffect, useRef, useState, type JSX } from 'react'
import { Button, useConfirm } from '@voicechat/ui-kit'
import type { CiCommand } from '@shared/ci'

/** Preview known environment references without interpreting shell syntax. */
export function previewCommand(script: string, env: Record<string, string>): string {
  if (typeof script !== 'string') return 'Текст команды недоступен'
  let quote: "'" | '"' | null = null
  let output = ''
  for (let i = 0; i < script.length; i++) {
    const character = script[i]
    if (character === '\\' && quote !== "'") {
      output += script.slice(i, i + 2)
      i++
      continue
    }
    if ((character === "'" || character === '"') && (!quote || quote === character)) {
      quote = quote ? null : character
      output += character
      continue
    }
    const variable = character === "$" && quote !== "'"
      ? /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(script.slice(i))
      : null
    if (variable) {
      output += env[variable[1] || variable[2]] ?? variable[0]
      i += variable[0].length - 1
    } else output += character
  }
  return output
}
function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export interface CiSlotEditorProps {
  label: string
  context?: import('@shared/ci').CiCommandContext | null
  projectId?: string
  commands: CiCommand[]
  value: string[]
  disabled?: boolean
  onChange: (next: string[]) => void
}

export function CiSlotEditor(props: CiSlotEditorProps): JSX.Element {
  const confirm = useConfirm()
  const [checking, setChecking] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const check = async (command: CiCommand): Promise<void> => {
    const context = props.context
    if (!context || checking || command.builtin || command.env?.PROD_DIR !== undefined) return
    setChecking(command.id)
    try {
      if (!(await confirm({ title: 'Проверить команду на машине?', message: `Это реальное выполнение на машине ${context.agentId}. Команда может изменить файлы.\n${command.script}`, confirmLabel: 'Выполнить проверку' }))) return
      const env = { ...context.env, ...command.env }
      const workdir = command.workdir ? `${context.workdir}/${command.workdir}` : context.workdir
      const script = `cd ${shellQuote(workdir)} && env ${Object.entries(env).map(([key, value]) => shellQuote(key + '=' + value)).join(' ')} bash -c ${shellQuote(command.script)}`
      controller.current = new AbortController()
      const timer = setTimeout(() => controller.current?.abort(), Math.min(command.timeoutSec ?? 30, 30) * 1000)
      try {
        const output = await window.fs?.exec(context.agentId, script, controller.current.signal, props.projectId)
        if (!output) throw new Error('Мост машины недоступен')
        setResult(`exit ${output.exitCode ?? '?'} · первые 50 строк\n${output.output.split('\n').slice(0, 50).join('\n')}`)
      } finally { clearTimeout(timer) }
    } catch (error) { setResult(`Проверка не выполнена: ${String(error)}`) }
    finally { setChecking(null) }
  }
  const nameOf = (id: string): string => props.commands.find((c) => c.id === id)?.name ?? '— удалена —'
  const move = (i: number, d: number): void => {
    const j = i + d
    if (j < 0 || j >= props.value.length) return
    const next = props.value.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    props.onChange(next)
  }
  const remove = (i: number): void => props.onChange(props.value.filter((_, k) => k !== i))
  const add = (id: string): void => { if (id) props.onChange([...props.value, id]) }

  return (
    <div className="ci-slot">
      <div className="ci-slot-label">{props.label}</div>
      <ol className="ci-slot-list">
        {props.value.length === 0 && <li className="ci-slot-empty">Команды не выбраны</li>}
        {props.value.map((id, i) => (
          <li key={`${id}-${i}`} className="ci-slot-item">
            <span className="ci-slot-name">{nameOf(id)}</span>
            {!props.disabled && (
              <span className="ci-slot-actions">
                <button type="button" aria-label="Выше" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                <button type="button" aria-label="Ниже" onClick={() => move(i, 1)} disabled={i === props.value.length - 1}>▼</button>
                <button type="button" aria-label="Убрать" onClick={() => remove(i)}>✕</button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <details className="ci-slot-preview">
        <summary>Предпросмотр: {props.label}</summary>
        <p>Машина: {props.context?.agentId ?? 'не выбрана'}. Подстановки окружения показаны для чтения; shell-выражения выполняются только при запуске.</p>
        <ol>{props.value.map((id, index) => {
          const command = props.commands.find((item) => item.id === id)
          if (!command) return <li key={index}>Команда удалена</li>
          const env = { ...props.context?.env, ...command.env }
          return <li key={index}><strong>{command.name}</strong>
            <div>Каталог: {props.context?.workdir ?? '$REPO_ROOT/$PROJECT'}{command.workdir ? '/' + command.workdir : ''}</div>
            <pre>{previewCommand(command.script, env)}</pre>
            {command.builtin ? <p>Встроенный шаг сервера.</p> : command.env?.PROD_DIR !== undefined ? <p>Команда перенаправляется в PROD_DIR; проверяйте её через workflow.</p>
              : <Button disabled={!props.context || !command.script || !!checking || props.disabled} onClick={() => void check(command)}>Проверить на машине</Button>}
          </li>
        })}</ol>
        {result && <pre role="status">{result}</pre>}
      </details>
      {!props.disabled && (
        <select className="sel ci-slot-add" value="" aria-label={`Добавить команду: ${props.label}`} onChange={(e) => { add(e.target.value); e.currentTarget.value = '' }}>
          <option value="">+ Добавить команду…</option>
          {props.commands.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.isCleanup ? ' (cleanup)' : ''}</option>
          ))}
        </select>
      )}
    </div>
  )
}
