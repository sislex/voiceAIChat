// Diff-вью для «Истории» Make: снимок слева, текущее справа. В браузере — Monaco DiffEditor
// (лениво, тот же чанк, что у редактора), в jsdom — два <pre> с построчной разметкой.
import { Suspense, lazy } from 'react'

export interface CodeDiffProps {
  path: string
  original: string
  modified: string
}

const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
const MonacoDiffEditor = lazy(() => import('./code/MonacoDiffEditor'))

export function CodeDiff(props: CodeDiffProps): JSX.Element {
  if (isJsdom) return <FallbackDiff {...props} />
  return (
    <Suspense fallback={<FallbackDiff {...props} />}>
      <MonacoDiffEditor {...props} />
    </Suspense>
  )
}

/** Простое построчное сравнение (LCS не нужен: показываем строки, отсутствующие в другой версии). */
export function FallbackDiff({ original, modified }: CodeDiffProps): JSX.Element {
  const left = original.split('\n'), right = modified.split('\n')
  const rightSet = new Set(right), leftSet = new Set(left)
  return (
    <div className="make-diff-fallback" data-testid="make-diff-fallback">
      <pre aria-label="Снимок">{left.map((l, i) => <span key={i} className={rightSet.has(l) ? '' : 'make-diff-removed'}>{l}{'\n'}</span>)}</pre>
      <pre aria-label="Сейчас">{right.map((l, i) => <span key={i} className={leftSet.has(l) ? '' : 'make-diff-added'}>{l}{'\n'}</span>)}</pre>
    </div>
  )
}
