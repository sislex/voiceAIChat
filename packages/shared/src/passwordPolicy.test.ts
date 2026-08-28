import { describe, expect, it } from 'vitest'
import { checkPasswordPolicy } from './passwordPolicy'

describe('checkPasswordPolicy', () => {
  it('отклоняет пустой, короткий, повторяющийся, частый и содержащий логин', () => {
    expect(checkPasswordPolicy('')).toMatch(/пустым/)
    expect(checkPasswordPolicy('short1')).toMatch(/короче 10/)
    expect(checkPasswordPolicy('aaaaaaaaaaaa')).toMatch(/повторяющегося/)
    expect(checkPasswordPolicy('Password123')).toMatch(/распространённый/)
    expect(checkPasswordPolicy('my-alice-pass-2026', { name: 'Alice' })).toMatch(/логин/)
  })
  it('принимает нормальный пароль', () => {
    expect(checkPasswordPolicy('correct horse battery', { name: 'bob' })).toBeNull()
  })
})
