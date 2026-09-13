import { useEffect, useRef, type ReactNode } from 'react'
import { CodeEditor as BaseCodeEditor, FallbackEditor, type CodeEditorProps } from '@voicechat/ui-foundation/components/CodeEditor'
import { CodeDiff as BaseCodeDiff, type CodeDiffProps } from '@voicechat/ui-foundation/components/CodeDiff'
import { localizeMakeText, mt, useMakeLocale } from '../i18n'

function EditorChrome({ children }: { children: ReactNode }): JSX.Element {
  const locale = useMakeLocale()
  const root = useRef<HTMLDivElement>(null)
  const adapter = useRef<{ refresh: () => void; dispose: () => void } | null>(null)
  useEffect(() => {
    let cancelled = false
    void import('../lib/monacoLocalization').then(({ localizeMonacoChrome }) => {
      if (!cancelled && root.current) adapter.current = localizeMonacoChrome(root.current)
    })
    return () => { cancelled = true; adapter.current?.dispose(); adapter.current = null }
  }, [])
  useEffect(() => { adapter.current?.refresh() }, [locale])
  return <div ref={root} style={{ display: 'contents' }} lang={locale}>{children}</div>
}

export function CodeEditor(props: CodeEditorProps): JSX.Element {
  useMakeLocale()
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const safeProps = props.readOnly ? { ...props, onChange: () => undefined, onSave: undefined, onInlineCommand: undefined } : props
  if (typeof memory === 'number' && memory > 0 && memory <= 2) return <FallbackEditor {...safeProps} />
  return <EditorChrome><BaseCodeEditor {...safeProps} translateUiText={localizeMakeText} loadingLabel={mt('loadingEditor')} /></EditorChrome>
}

export function CodeDiff(props: CodeDiffProps): JSX.Element {
  useMakeLocale()
  return <EditorChrome><BaseCodeDiff {...props} loadingLabel={mt('loadingDiff')} originalLabel={mt('diffSnapshot')} modifiedLabel={mt('diffCurrent')} /></EditorChrome>
}
