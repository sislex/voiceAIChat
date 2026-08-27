import { describe, expect, it } from 'vitest'
import { dirOfPath, moveTargetPath } from './makeTree'

describe('makeTree', () => {
  it('moveTargetPath переносит имя файла в папку или в корень', () => {
    expect(moveTargetPath('src/App.tsx', 'lib')).toBe('lib/App.tsx')
    expect(moveTargetPath('src/App.tsx', '')).toBe('App.tsx')
    expect(moveTargetPath('index.html', 'pages')).toBe('pages/index.html')
    expect(dirOfPath('src/components/a.tsx')).toBe('src')
    expect(dirOfPath('a.css')).toBe('')
  })
})
