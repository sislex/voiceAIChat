import { describe, it, expect } from 'vitest'
import { isReadOnlyCommand } from './console.js'

describe('ci console: белый список read-only', () => {
  it('пропускает безопасные команды чтения', () => {
    for (const c of ['ls -la', 'cat file.txt', 'git status', 'git log --oneline', 'pwd', 'grep foo bar', 'head -n 5 x']) {
      expect(isReadOnlyCommand(c)).toBe(true)
    }
  })
  it('блокирует запись, сеть, цепочки и запрещённые бинарники', () => {
    for (const c of ['rm -rf /', 'curl http://x', 'git push', 'echo x > f', 'ls; rm y', 'cat a | sh', 'npm ci', 'git config --global user.x y']) {
      expect(isReadOnlyCommand(c)).toBe(false)
    }
  })
})
