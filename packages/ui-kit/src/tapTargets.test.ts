// Порог попадания пальцем у кнопки без подписи.
//
// До круга 8 правило повторялось в каждой секции app.css (.jcard,
// .ptypes-actions, .side, .proj-invite-actions), поэтому каждая новая секция
// про него забывала: во флекс-строке иконка сжимается до 19x22 — вдвое ниже
// порога, который сторожит scripts/mobile-shots.mts. Место правилу — у самой
// кнопки, здесь.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8')

describe('минимум 40px у .vc-btn--icon', () => {
  it('задан в ui-kit под мобильным вьюпортом', () => {
    const rule = styles.match(/@media \(max-width: 640px\) \{[^}]*\.vc-btn--icon[^}]*\}/)
    expect(rule?.[0]).toContain('min-width:40px')
    expect(rule?.[0]).toContain('min-height:40px')
  })
})
