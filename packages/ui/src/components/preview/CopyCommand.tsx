import { useEffect, useRef, useState } from 'react'
import { Button } from '@voicechat/ui-kit'
import { copyText } from '../../lib/clipboard'

type CopyState = 'idle' | 'copying' | 'copied' | 'failed'

export function CopyCommand({ command }: { command: string | null }): JSX.Element | null {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<number | null>(null)
  const current = useRef(command)
  const mounted = useRef(true)

  useEffect(() => {
    current.current = command
    setState('idle')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [command])

  useEffect(() => () => {
    mounted.current = false
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  if (!command) return null

  const copy = async (): Promise<void> => {
    if (!command || state === 'copying') return
    const attempted = command
    setState('copying')
    const copied = await copyText(attempted)
    if (!mounted.current || current.current !== attempted) return
    if (!copied) {
      setState('failed')
      return
    }
    setState('copied')
    timer.current = window.setTimeout(() => {
      timer.current = null
      if (mounted.current && current.current === attempted) setState('idle')
    }, 2_000)
  }

  return <>
    <code>{command}</code>
    <Button size="sm" variant="ghost" disabled={state === 'copying'} onClick={() => void copy()}>
      {state === 'copied' ? 'Скопировано' : 'Копировать команду'}
    </Button>
    <span className="sr-only" aria-live="polite">
      {state === 'copied' ? 'Команда скопирована' : state === 'failed' ? 'Не удалось скопировать команду' : ''}
    </span>
    {state === 'failed' && <small className="feature-preview__error">Не удалось скопировать команду</small>}
  </>
}
