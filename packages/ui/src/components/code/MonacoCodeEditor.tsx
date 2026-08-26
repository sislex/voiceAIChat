import { useMemo, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { attachJsxAutoClose, setupMonaco } from './monacoSetup'
import { monacoLanguageFor } from './monacoLang'
import type { CodeEditorProps } from '../CodeEditor'

/** Редактор на Monaco — настоящий VS Code: подсветка TSX/JSX, автодополнение, поиск, сворачивание. */
export default function MonacoCodeEditor({ path, value, onChange, onSave, ariaLabel }: CodeEditorProps): JSX.Element {
  const monaco = useMemo(() => setupMonaco(), [])
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const onMount: OnMount = (editor, m) => {
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveRef.current?.())
    attachJsxAutoClose(editor, m)
    editor.focus()
  }
  return (
    <div className="make-monaco" data-testid="make-monaco" aria-label={ariaLabel} role="group">
      <Editor
        key={path}
        path={path}
        language={monacoLanguageFor(path)}
        value={value}
        theme="vs-dark"
        onChange={(next) => onChange(next ?? '')}
        onMount={onMount}
        loading={<div className="make-monaco-loading">Загружаю редактор…</div>}
        options={{
          fontSize: 12.5,
          fontFamily: "'SF Mono', ui-monospace, Menlo, Consolas, monospace",
          tabSize: 2,
          insertSpaces: true,
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          autoClosingBrackets: 'languageDefined',
          autoClosingQuotes: 'languageDefined',
          formatOnPaste: true,
          smoothScrolling: true,
          padding: { top: 8 },
          ariaLabel
        }}
      />
      {/* monaco экспортируется через setupMonaco, чтобы loader не ходил в CDN */}
      {monaco ? null : null}
    </div>
  )
}
