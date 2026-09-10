import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('панель сохраняет собственные стили меню инструментов', () => {
  expect(readFileSync(new URL('./panel.css', import.meta.url), 'utf8')).toMatch(
    /\.webpreview-tools(?:\s|\{)/
  )
})
