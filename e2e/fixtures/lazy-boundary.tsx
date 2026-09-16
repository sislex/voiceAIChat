import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { UiProviders, Button } from '@voicechat/ui-kit'
import { lazyScreen } from '../../packages/ui/src/runtime/lazyScreen'
import '../../packages/ui/src/styles/global.css'

let attempts = 0
const Optional = lazyScreen(async () => {
  attempts++
  document.body.dataset.loadAttempts = String(attempts)
  if (location.search.includes('network')) return import('./optional-ready')
  await new Promise(resolve => setTimeout(resolve, 250))
  if (attempts === 1) throw new Error('Fixture chunk unavailable')
  return { default: () => <section aria-label="Optional ready" style={{ minHeight: 160 }}>Ready</section> }
})
function Fixture(): JSX.Element {
  const [open, setOpen] = useState(false)
  // Mirrors the host's persisted chat draft contract across an explicit refresh.
  const [draft, setDraft] = useState(() => localStorage.getItem('fixture-draft') ?? 'Unsaved draft')
  return <UiProviders><div style={{ minHeight: '100dvh', display: 'grid', gridTemplateRows: 'auto 1fr auto', padding: 'max(var(--qa-safe-area, 8px), env(safe-area-inset-top)) max(var(--qa-safe-area, 8px), env(safe-area-inset-right)) max(var(--qa-safe-area, 8px), env(safe-area-inset-bottom)) max(var(--qa-safe-area, 8px), env(safe-area-inset-left))', boxSizing: 'border-box', overflowWrap: 'anywhere' }}>
    <header><h1>Shell</h1><Button onMouseEnter={() => void Optional.preload()} onFocus={() => void Optional.preload()} onTouchStart={() => void Optional.preload()} onClick={() => setOpen(true)}>Open optional</Button><Button onClick={() => setOpen(false)}>Close optional</Button></header>
    <main style={{ minWidth: 0 }}>{open && <Optional />}</main>
    <label>Draft<textarea aria-label="Draft" value={draft} onChange={event => { setDraft(event.target.value); localStorage.setItem('fixture-draft', event.target.value) }} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
  </div></UiProviders>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
