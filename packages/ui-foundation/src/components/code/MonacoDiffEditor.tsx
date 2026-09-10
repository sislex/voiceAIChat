import { useMemo } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { setupMonaco } from './monacoSetup'
import { monacoLanguageFor } from './monacoLang'
import type { CodeDiffProps } from '../CodeDiff'

/** Сравнение двух версий файла на Monaco DiffEditor (снимок ↔ текущее), только чтение. */
export default function MonacoDiffEditor({ path, original, modified }: CodeDiffProps): JSX.Element {
  useMemo(() => setupMonaco(), [])
  return (
    <div className="make-monaco make-monaco--diff" data-testid="make-monaco-diff">
      <DiffEditor
        original={original}
        modified={modified}
        language={monacoLanguageFor(path)}
        theme="vs-dark"
        loading={<div className="make-monaco-loading">Загружаю сравнение…</div>}
        options={{ readOnly: true, renderSideBySide: true, fontSize: 12.5, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, originalEditable: false }}
      />
    </div>
  )
}
