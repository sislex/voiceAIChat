import { describe, expect, it } from 'vitest'
import { addComponentImports, componentExports, pickEntryFile, relativeImportPath } from './makeAutoImport'

describe('makeAutoImport', () => {
  it('componentExports: named/default/re-export', () => {
    expect(componentExports('src/components/Card.tsx', 'export const Card = () => null\nexport function CardTitle() {}\nexport default Card\nexport { helper, Badge as CardBadge }')).toEqual({ names: ['Card', 'CardTitle', 'CardBadge'], hasDefault: true })
  })
  it('relativeImportPath', () => {
    expect(relativeImportPath('src/App.tsx', 'src/components/Card.tsx')).toBe('./components/Card')
    expect(relativeImportPath('src/pages/Home.tsx', 'src/components/Card.tsx')).toBe('../components/Card')
    expect(relativeImportPath('App.tsx', 'src/components/Card.tsx')).toBe('./src/components/Card')
  })
  it('addComponentImports: вставляет после последнего import, пропускает уже импортированное', () => {
    const entry = "import React from 'react'\nimport { Button } from './components/Button'\n\nexport function App() { return <Button /> }"
    const r = addComponentImports('src/App.tsx', entry, [
      { path: 'src/components/Button.tsx', names: ['Button'] },
      { path: 'src/components/Card.tsx', names: ['Card', 'CardTitle'] },
      { path: 'src/components/Hero.tsx', names: [], defaultName: 'Hero' }
    ])
    expect(r.added).toEqual(['Card', 'CardTitle', 'Hero'])
    expect(r.source.split('\n').slice(0, 4)).toEqual([
      "import React from 'react'",
      "import { Button } from './components/Button'",
      "import { Card, CardTitle } from './components/Card'",
      "import Hero from './components/Hero'"
    ])
    expect(addComponentImports('src/App.tsx', r.source, [{ path: 'src/components/Card.tsx', names: ['Card'] }]).added).toEqual([])
  })
  it('pickEntryFile', () => {
    expect(pickEntryFile(['index.html', 'src/main.tsx', 'src/App.tsx'])).toBe('src/App.tsx')
    expect(pickEntryFile(['index.html', 'app.js'])).toBeNull()
  })
})
